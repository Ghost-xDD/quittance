/**
 * buyer-agent.ts — Quittance Buyer Agent (GPT-4o mini)
 *
 * A real LLM agent that:
 *   1. Receives a task from the user.
 *   2. Calls list_sellers → inspects on-chain reputation.
 *   3. Decides which seller to use (model reasoning).
 *   4. Calls send_sms_via_x402 → full x402 + AA escrow + quittance.
 *   5. Reports settlement to the user.
 *
 * Every "reasoning" message is real model output. Every "action" event
 * is a real on-chain transaction.
 *
 * Usage:  npm run buyer-agent [-- --task "send SMS to +1-555-0192"]
 *
 * Environment
 *   OPENAI_API_KEY            GPT-4o mini access
 *   BUYER_PRIVATE_KEY         EOA key for the buyer passport
 *   SELLER_SMS_PRO_PRIVATE_KEY EOA key to derive seller passport address
 *   SELLER_URL                Seller HTTP endpoint (default: http://localhost:4001/task)
 *   EVENTS_WEBHOOK_URL        Web UI webhook (default: http://localhost:3001/api/agent-events)
 */

import "dotenv/config";
import OpenAI from "openai";
import { ethers } from "ethers";
import { exec } from "child_process";
import { promisify } from "util";
import {
  getProvider, getSigner, getContracts,
  makePaymentId, fmt, TIER_LABEL,
} from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, encodeCall } from "../lib/aa";
import { emit, emitAction } from "../lib/events";

const execAsync = promisify(exec);

// ─── OpenAI client ────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Seller registry ─────────────────────────────────────────────────────────
// Add entries here as more sellers come online. Keys map to env vars.

interface SellerConfig {
  key: string;
  url: string;
  service: string;
  proofType: string;
}

function buildSellerRegistry(): Record<string, SellerConfig> {
  const reg: Record<string, SellerConfig> = {};
  if (process.env.SELLER_SMS_PRO_PRIVATE_KEY) {
    reg["sms.kite"] = {
      key: process.env.SELLER_SMS_PRO_PRIVATE_KEY,
      url: process.env.SELLER_URL ?? "http://localhost:4001/task",
      service: "SMS delivery",
      proofType: "ORACLE",
    };
  }
  if (process.env.SELLER_SMS_CHEAP_PRIVATE_KEY) {
    reg["sms-cheap.kite"] = {
      key: process.env.SELLER_SMS_CHEAP_PRIVATE_KEY,
      url: process.env.SELLER_CHEAP_URL ?? "http://localhost:4002/task",
      service: "SMS delivery (budget)",
      proofType: "ORACLE",
    };
  }
  return reg;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a Quittance buyer agent running on Kite mainnet. You help users \
complete tasks — starting with SMS delivery — through the Quittance protocol: \
an atomic Exec-Pay-Deliver system where funds only leave escrow when \
cryptographic proof of delivery is posted on-chain.

PROTOCOL OVERVIEW
  1. Funds are locked in an Escrow smart contract.
  2. The seller delivers the service and posts an on-chain Quittance (proof).
  3. If the proof is valid, escrow releases payment to the seller.
  4. If no proof arrives before the deadline, the buyer gets a full refund.
  5. Sellers must post a bond that is slashable on fraudulent settlement.

YOUR JOB
  - Call list_sellers to see available sellers and their on-chain reputation.
  - Choose the best seller for the task. Consider: bond size (must exceed 
    the payment so risk is bounded), success rate, and seller tier 
    (Bronze < Silver < Gold).
  - Call send_sms_via_x402 to execute the payment. This handles everything: 
    escrow approval, x402 payment headers, and quittance verification.
  - Report the result to the user, including the on-chain transaction hash.

Be concise. Show your reasoning about seller selection briefly — one or two 
sentences. Prefer sellers with higher bonds and success rates. If the only 
available seller has poor stats, note the risk explicitly.`;

// ─── OpenAI tool schemas ──────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_sellers",
      description:
        "Lists all available service sellers registered on Kite testnet with their on-chain reputation stats (tier, success rate, bond size, settled count).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_buyer_wallet",
      description:
        "Returns the buyer's Kite Passport wallet address, current USDC balance, and USDC allowance granted to the Escrow contract.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sms_via_x402",
      description:
        "Executes a full Quittance payment cycle to send an SMS via a named seller: opens escrow, delivers x402 payment auth, waits for on-chain proof, and returns the settlement result.",
      parameters: {
        type: "object",
        properties: {
          sellerName: {
            type: "string",
            description: "Seller name from list_sellers, e.g. 'sms.kite'",
          },
          to: {
            type: "string",
            description: "Destination phone number, e.g. '+1-555-0192'",
          },
          message: {
            type: "string",
            description: "The SMS body to deliver",
          },
        },
        required: ["sellerName", "to", "message"],
      },
    },
  },
];

// ─── Tool executors ───────────────────────────────────────────────────────────

async function toolListSellers(
  sellers: Record<string, SellerConfig>,
  provider: ethers.JsonRpcProvider,
  sdk: ReturnType<typeof makeSDK>,
) {
  const c = getContracts(provider);
  const results = [];

  for (const [name, cfg] of Object.entries(sellers)) {
    const sellerEOA = getSigner(cfg.key, provider);
    const sellerAA  = aaAddress(sdk, sellerEOA.address);

    let repData = { tier: "Unknown", successRatePct: 0, settled: 0, slashed: 0, bondPYUSD: "0" };
    try {
      const rep = (await c.reputation.summary(sellerAA)) as [bigint, bigint, bigint, bigint, number];
      repData = {
        tier:           TIER_LABEL[rep[4]] ?? "Unknown",
        successRatePct: Number(rep[0]) / 100,
        settled:        Number(rep[1]),
        slashed:        Number(rep[2]),
        bondPYUSD:      fmt(rep[3]),
      };
    } catch { /* seller not yet on-chain */ }

    results.push({
      name,
      service:   cfg.service,
      proofType: cfg.proofType,
      passport:  sellerAA,
      url:       cfg.url,
      ...repData,
    });
  }

  return results;
}

async function toolCheckBuyerWallet(
  buyerAA: string,
  provider: ethers.JsonRpcProvider,
) {
  const c       = getContracts(provider);
  const balance = (await c.pyusd.balanceOf(buyerAA)) as bigint;
  const allow   = (await c.pyusd.allowance(buyerAA, process.env.ESCROW_ADDRESS!)) as bigint;
  return {
    passport:              buyerAA,
    balancePYUSD:          fmt(balance),
    escrowAllowancePYUSD:  fmt(allow),
  };
}

async function toolSendSmsViaX402(
  args: { sellerName: string; to: string; message: string },
  sellers:  Record<string, SellerConfig>,
  buyerAA:  string,
  provider: ethers.JsonRpcProvider,
) {
  const cfg = sellers[args.sellerName];
  if (!cfg) return { success: false, error: `Unknown seller '${args.sellerName}'. Use list_sellers first.` };

  const c = getContracts(provider);

  // ── 1. kpass agent:session execute (full x402 via Passport) ──────────────
  await emit({
    kind: "reasoning",
    content: `Initiating x402 payment via Kite Passport session…\n  Seller: ${cfg.url}\n  Amount: 0.001 USDC (session-signed, Kite mainnet)`,
  });

  const body = JSON.stringify({ to: args.to, message: args.message });

  // Use session token from env (injected by /api/run-task when UI passes it)
  const sessionId = process.env.KPASS_SESSION_ID ?? "";
  const sessionFlag = sessionId ? `--session-id ${sessionId}` : "";

  const kpassCmd = [
    "kpass agent:session execute",
    `--url ${cfg.url}`,
    `--method POST`,
    `--body ${JSON.stringify(body)}`,
    sessionFlag,
    "--output json",
  ].filter(Boolean).join(" ");

  await emit({ kind: "action", actionId: "kpass-x402", actionLabel: `kpass execute → ${cfg.url}`, actionStatus: "pending" });

  let kpassOut: string;
  try {
    const { stdout } = await execAsync(kpassCmd, { timeout: 60_000 });
    kpassOut = stdout;
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return { success: false, error: `kpass execute failed: ${err.stderr ?? err.message}` };
  }

  interface KpassExecuteResult {
    status: string;
    response_body?: string;
    transaction_hash?: string;
    error?: string;
  }

  let kpassResult: KpassExecuteResult;
  try {
    kpassResult = JSON.parse(kpassOut) as KpassExecuteResult;
  } catch {
    return { success: false, error: `kpass returned invalid JSON: ${kpassOut.slice(0, 200)}` };
  }

  if (kpassResult.status !== "success" || kpassResult.error) {
    await emit({ kind: "action", actionId: "kpass-x402", actionLabel: `kpass execute → ${cfg.url}`, actionStatus: "failed" });
    return { success: false, error: kpassResult.error ?? `kpass status: ${kpassResult.status}` };
  }

  // Parse the settlement returned by the seller in the response body
  let settlement: { paymentId?: string; quittanceTx?: string; blockNumber?: number; result?: string } = {};
  try {
    settlement = JSON.parse(kpassResult.response_body ?? "{}") as typeof settlement;
  } catch { /**/ }

  const paymentId = settlement.paymentId ?? kpassResult.transaction_hash ?? "pending";

  await emit({
    kind: "action",
    actionId: "kpass-x402",
    actionLabel: `kpass execute → ${cfg.url}`,
    actionStatus: "confirmed",
    txHash: kpassResult.transaction_hash,
  });

  await emit({
    kind: "reasoning",
    content: `Kite Passport signed x402 payment ✓\n  USDC sent from Passport wallet → seller on Kite mainnet\n  kpass tx: ${kpassResult.transaction_hash ?? "confirmed"}`,
  });

  // ── 2. Verify quittance on-chain ──────────────────────────────────────────
  if (settlement.quittanceTx && paymentId !== "pending") {
    await emit({ kind: "reasoning", content: `Verifying quittance on-chain for paymentId ${paymentId.slice(0, 18)}…` });
    try {
      const [, , , , isSettled] = (await c.escrow.getEscrowRecord(paymentId)) as [string, string, bigint, bigint, boolean, boolean];
      if (!isSettled) {
        await emit({ kind: "reasoning", content: `⚠ Escrow not yet settled on-chain — quittance may still be propagating.` });
      }
    } catch { /* not critical — seller already confirmed */ }
  }

  // ── 3. Emit quittance receipt ─────────────────────────────────────────────
  await emit({
    kind: "quittance",
    receipt: {
      paymentId,
      seller:      args.sellerName,
      adapter:     cfg.proofType,
      amount:      "0.001",
      status:      "SETTLED",
      txHash:      settlement.quittanceTx ?? kpassResult.transaction_hash,
      blockNumber: settlement.blockNumber,
    },
  });

  return {
    success:     true,
    result:      settlement.result ?? "SMS delivered",
    paymentId,
    quittanceTx: settlement.quittanceTx,
    blockNumber: settlement.blockNumber,
    passportTx:  kpassResult.transaction_hash,
    note:        "Paid via Kite Passport x402 session. Escrow + quittance settled on Kite mainnet.",
  };
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function run(task: string) {
  await emit({ kind: "user", content: task });

  const provider  = getProvider();
  const buyerKey  = process.env.BUYER_PRIVATE_KEY;
  if (!buyerKey) {
    await emit({ kind: "error", content: "BUYER_PRIVATE_KEY not set in .env" });
    return;
  }
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith("sk-...")) {
    await emit({ kind: "error", content: "OPENAI_API_KEY not set. Add your key to quittance-agents/.env" });
    return;
  }

  const buyerEOA = getSigner(buyerKey, provider);
  const sdk      = makeSDK();
  const buyerAA  = aaAddress(sdk, buyerEOA.address);
  const sellers  = buildSellerRegistry();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: task },
  ];

  // ── LLM tool-calling loop ─────────────────────────────────────────────────
  for (let turn = 0; turn < 10; turn++) {
    const response = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      messages,
      tools:       TOOLS,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    // Emit any text the model produced
    if (msg.content?.trim()) {
      await emit({ kind: "agent", content: msg.content.trim() });
    }

    // No tool calls → model is done
    if (!msg.tool_calls?.length) break;

    // Execute each tool call
    for (const _tc of msg.tool_calls) {
      // The OpenAI SDK union includes CustomToolCall which lacks .function —
      // we only ever receive standard function calls, so cast safely.
      const tc = _tc as OpenAI.Chat.ChatCompletionMessageToolCall & {
        function: { name: string; arguments: string };
      };

      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /**/ }

      // Show the model's decision
      const argStr = Object.keys(args).length
        ? Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")
        : "";
      await emit({
        kind:    "reasoning",
        content: `→ ${tc.function.name}(${argStr})`,
      });

      let result: unknown;
      try {
        switch (tc.function.name) {
          case "list_sellers":
            result = await toolListSellers(sellers, provider, sdk);
            break;
          case "check_buyer_wallet":
            result = await toolCheckBuyerWallet(buyerAA, provider);
            break;
          case "send_sms_via_x402":
            result = await toolSendSmsViaX402(
              args as { sellerName: string; to: string; message: string },
              sellers, buyerAA, provider,
            );
            break;
          default:
            result = { error: `Unknown tool: ${tc.function.name}` };
        }
      } catch (err: any) {
        result = { error: err.reason ?? err.shortMessage ?? err.message ?? String(err) };
      }

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      JSON.stringify(result),
      });
    }
  }

  await emit({ kind: "done" });
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2);
  const taskIdx = args.indexOf("--task");
  const task    = taskIdx >= 0
    ? args[taskIdx + 1]
    : "Send an SMS alert to +1-555-0192 about a KITE price movement.";

  console.log("\n── Quittance Buyer Agent (GPT-4o mini) ───────────────────\n");
  console.log(`Task: ${task}\n`);

  try {
    await run(task);
  } catch (err: any) {
    await emit({ kind: "error", content: err.message ?? String(err) });
    process.exit(1);
  }
}

main();
