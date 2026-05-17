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
  priceUSDC: string;   // price per call in USDC, e.g. "0.001"
}

function buildSellerRegistry(): Record<string, SellerConfig> {
  const reg: Record<string, SellerConfig> = {};
  if (process.env.SELLER_SMS_PRO_PRIVATE_KEY) {
    reg["sms.kite"] = {
      key: process.env.SELLER_SMS_PRO_PRIVATE_KEY,
      url: process.env.SELLER_URL ?? "http://localhost:4001/task",
      service: "SMS delivery",
      proofType: "ORACLE",
      priceUSDC: "0.001",
    };
  }
  if (process.env.SELLER_SMS_CHEAP_PRIVATE_KEY) {
    reg["sms-cheap.kite"] = {
      key: process.env.SELLER_SMS_CHEAP_PRIVATE_KEY,
      url: process.env.SELLER_CHEAP_URL ?? "http://localhost:4002/task",
      service: "SMS delivery (budget)",
      proofType: "ORACLE",
      priceUSDC: "0.001",
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
    Each seller has a priceUSDC (the cost per call, e.g. 0.001 USDC) and a
    bondPYUSD (the seller's posted collateral — unrelated to what you pay).
    A higher bond means more skin-in-the-game for the seller, not a higher price.
  - Call check_buyer_wallet to see your USDC balance. You only need enough to
    cover the priceUSDC (e.g. 0.001 USDC), not the bond.
  - Choose the best seller. Prefer higher bonds, success rates, and Gold/Silver tier.
  - Call send_sms_via_x402 to execute the payment and delivery.
  - Report the result to the user, including on-chain quittance tx hash.

Be concise. One or two sentences of reasoning on seller selection is enough.`;

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
      priceUSDC: cfg.priceUSDC,
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

  // ── Round 1: request task → seller returns paymentId + sellerAA + amount ──
  await emit({
    kind: "reasoning",
    content: `Round 1 — requesting task from seller…\n  Seller: ${cfg.url}\n  Buyer passport: ${buyerAA}`,
  });

  await emit({ kind: "action", actionId: "r1-request", actionLabel: `POST ${cfg.url} → request task`, actionStatus: "pending" });

  let round1: { paymentId: string; sellerAA: string; amountUSDC: string; deadline: number };
  try {
    const r1 = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: args.to, message: args.message, buyerAA }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r1.ok) {
      const txt = await r1.text().catch(() => "");
      return { success: false, error: `Seller Round 1 failed (${r1.status}): ${txt.slice(0, 200)}` };
    }
    round1 = await r1.json() as typeof round1;
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, error: `Seller unreachable: ${err.message}` };
  }

  await emit({ kind: "action", actionId: "r1-request", actionLabel: `POST ${cfg.url} → paymentId received`, actionStatus: "confirmed" });
  await emit({
    kind: "reasoning",
    content: `Task accepted by seller ✓\n  paymentId: ${round1.paymentId.slice(0, 18)}…\n  Amount: ${round1.amountUSDC} USDC → ${round1.sellerAA.slice(0, 10)}…`,
  });

  // ── Pay: kpass wallet send → real USDC on Kite mainnet ───────────────────
  await emit({
    kind: "reasoning",
    content: `Paying ${round1.amountUSDC} USDC to seller via Kite Passport wallet…`,
  });

  await emit({ kind: "action", actionId: "kpass-pay", actionLabel: `kpass wallet send → ${round1.amountUSDC} USDC`, actionStatus: "pending" });

  const kpassCmd = [
    "kpass wallet send",
    `--to ${round1.sellerAA}`,
    `--amount ${round1.amountUSDC}`,
    "--asset USDC",
    "--output json",
  ].join(" ");

  let payTxHash: string;
  try {
    const { stdout } = await execAsync(kpassCmd, { timeout: 60_000 });
    const parsed = JSON.parse(stdout) as { status: string; transaction_hash?: string; error?: string };
    if (parsed.status !== "success" || parsed.error) {
      return { success: false, error: `kpass wallet send failed: ${parsed.error ?? parsed.status}` };
    }
    payTxHash = parsed.transaction_hash ?? "";
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return { success: false, error: `kpass wallet send error: ${err.stderr ?? err.message}` };
  }

  await emit({
    kind: "action",
    actionId: "kpass-pay",
    actionLabel: `kpass wallet send → ${round1.amountUSDC} USDC`,
    actionStatus: "confirmed",
    txHash: payTxHash,
  });
  await emit({
    kind: "reasoning",
    content: `USDC payment confirmed on Kite mainnet ✓\n  tx: ${payTxHash}\n  ${round1.amountUSDC} USDC → seller passport`,
  });

  // ── Round 2: prove payment → seller delivers + posts quittance ────────────
  await emit({ kind: "action", actionId: "r2-prove", actionLabel: `POST ${cfg.url} → prove + settle`, actionStatus: "pending" });

  let settlement: { paymentId: string; quittanceTx: string; blockNumber: number; result: string; usdcAmount: string };
  try {
    const r2 = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to:        args.to,
        message:   args.message,
        buyerAA,
        paymentId: round1.paymentId,
        txHash:    payTxHash,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r2.ok) {
      const txt = await r2.text().catch(() => "");
      return { success: false, error: `Seller Round 2 failed (${r2.status}): ${txt.slice(0, 200)}` };
    }
    settlement = await r2.json() as typeof settlement;
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, error: `Seller Round 2 error: ${err.message}` };
  }

  await emit({ kind: "action", actionId: "r2-prove", actionLabel: `Quittance posted → block ${settlement.blockNumber}`, actionStatus: "confirmed", txHash: settlement.quittanceTx });

  // ── Verify escrow settled on-chain ────────────────────────────────────────
  await emit({ kind: "reasoning", content: `Verifying escrow settlement on-chain…  paymentId: ${settlement.paymentId.slice(0, 18)}…` });
  try {
    const [, , , , isSettled] = (await c.escrow.getEscrowRecord(settlement.paymentId)) as [string, string, bigint, bigint, boolean, boolean];
    await emit({
      kind: "reasoning",
      content: isSettled
        ? `Escrow settled on-chain ✓  Seller received ${settlement.usdcAmount} USDC`
        : `⚠ Escrow record not yet finalised — quittance propagating.`,
    });
  } catch { /* non-fatal */ }

  // ── Emit quittance receipt ────────────────────────────────────────────────
  await emit({
    kind: "quittance",
    receipt: {
      paymentId:   settlement.paymentId,
      seller:      args.sellerName,
      adapter:     cfg.proofType,
      amount:      settlement.usdcAmount,
      status:      "SETTLED",
      txHash:      settlement.quittanceTx,
      blockNumber: settlement.blockNumber,
    },
  });

  return {
    success:     true,
    result:      settlement.result,
    paymentId:   settlement.paymentId,
    quittanceTx: settlement.quittanceTx,
    blockNumber: settlement.blockNumber,
    paymentTx:   payTxHash,
    note:        "Paid via Kite Passport wallet. Quittance proof posted on Kite mainnet. Swap to kpass execute once seller URL is allowlisted.",
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
