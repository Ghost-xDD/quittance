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
import {
  getProvider, getSigner, getContracts,
  makePaymentId, fmt, TIER_LABEL,
} from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, encodeCall } from "../lib/aa";
import { buildPaymentHeaders } from "../lib/x402";
import { emit, emitAction } from "../lib/events";
import type { X402Challenge, X402Settlement } from "../lib/x402";

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
You are a Quittance buyer agent running on Kite testnet. You help users \
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
        "Returns the buyer's AA passport address, current PYUSD balance, and PYUSD allowance granted to the Escrow contract.",
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
  buyerEOA: ethers.Wallet,
  buyerAA:  string,
  sdk:      ReturnType<typeof makeSDK>,
  provider: ethers.JsonRpcProvider,
) {
  const cfg = sellers[args.sellerName];
  if (!cfg) return { success: false, error: `Unknown seller '${args.sellerName}'. Use list_sellers first.` };

  const c          = getContracts(provider);
  const sellerEOA  = getSigner(cfg.key, provider);
  const sellerAA   = aaAddress(sdk, sellerEOA.address);
  const MAX_APPROVE = ethers.parseUnits("10", 18);
  const PAYMENT    = ethers.parseUnits("0.001", 18);

  // ── 1. Auto top-up buyer AA if balance is low ───────────────────────────────
  const pyusdBal = (await c.pyusd.balanceOf(buyerAA)) as bigint;
  if (pyusdBal < PAYMENT) {
    const topUp    = ethers.parseUnits("0.01", 18);
    const eoaBal   = (await c.pyusd.balanceOf(buyerEOA.address)) as bigint;
    const source   = eoaBal >= topUp ? buyerEOA : (
      (await c.pyusd.balanceOf(sellerEOA.address) as bigint) >= topUp ? sellerEOA : null
    );
    if (!source) return { success: false, error: `Buyer AA has ${fmt(pyusdBal)} PYUSD and no funded EOA to top up from.` };

    await emit({ kind: "reasoning", content: `Buyer AA balance low (${fmt(pyusdBal)} PYUSD) — topping up 0.01 PYUSD from ${source === buyerEOA ? "buyer" : "seller"} EOA…` });
    const tx = await (c.pyusd.connect(source) as typeof c.pyusd).transfer(buyerAA, topUp);
    await tx.wait();
  }

  // ── 2. Ensure escrow allowance ────────────────────────────────────────────
  const allowance = (await c.pyusd.allowance(buyerAA, process.env.ESCROW_ADDRESS!)) as bigint;
  if (allowance < PAYMENT) {
    await emit({ kind: "reasoning", content: `Approving Escrow to spend up to 10 PYUSD via AA UserOp (gasless)…` });
    const approveCD = encodeCall(
      "function approve(address spender, uint256 amount) returns (bool)",
      [process.env.ESCROW_ADDRESS!, MAX_APPROVE],
    );
    const approveResult = await emitAction("approve-escrow", "PYUSD.approve(Escrow, 10 PYUSD)", () =>
      aaSend(sdk, buyerEOA, process.env.PYUSD_ADDRESS!, approveCD),
    );
    await emit({
      kind: "action",
      actionId: "approve-escrow",
      actionLabel: "PYUSD.approve(Escrow, 10 PYUSD)",
      actionStatus: "confirmed",
      txHash: approveResult.txHash,
      blockNumber: approveResult.blockNumber,
    });
  }

  // ── 3. x402 round 1: get payment challenge ────────────────────────────────
  await emit({ kind: "reasoning", content: `x402 round 1 → ${cfg.url} (expecting 402 challenge)…` });

  const r1 = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: args.to, message: args.message }),
  });
  const d1 = await r1.json() as X402Challenge | { error: string };

  if (r1.status !== 402) {
    return { success: false, error: `Expected 402, got ${r1.status}: ${JSON.stringify(d1)}` };
  }

  const challenge = d1 as X402Challenge;
  await emit({
    kind: "reasoning",
    content: `402 challenge received — seller passport ${challenge.sellerPassport.slice(0,10)}…  amount ${fmt(BigInt(challenge.amount))} PYUSD  deadline T+${challenge.deadlineOffset}s`,
  });

  // ── 4. Build paymentId + payment headers ──────────────────────────────────
  const block     = await provider.getBlock("latest");
  const deadline  = BigInt(block!.timestamp) + BigInt(challenge.deadlineOffset);
  const amount    = BigInt(challenge.amount);
  const nonce     = ethers.randomBytes(32);
  const paymentId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);

  await emit({
    kind: "reasoning",
    content: `paymentId = ${paymentId}\nConstructed from keccak256(buyerAA, sellerAA, ${fmt(amount)} PYUSD, deadline, nonce).`,
  });

  const headers = buildPaymentHeaders(paymentId, nonce, buyerAA, amount, deadline);

  // ── 5. x402 round 2: send payment auth ───────────────────────────────────
  await emit({ kind: "reasoning", content: `x402 round 2 → sending payment authorisation to seller…` });

  const r2 = await fetch(cfg.url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify({ to: args.to, message: args.message }),
  });
  const d2 = await r2.json() as X402Settlement | { error: string; code?: string };

  if (r2.status !== 200) {
    const err = d2 as { error: string; code?: string };
    return { success: false, error: `Seller returned ${r2.status}: ${err.error}`, code: err.code };
  }

  const settlement = d2 as X402Settlement;

  // ── 6. Verify on-chain ────────────────────────────────────────────────────
  await emit({ kind: "reasoning", content: `Verifying escrow.settled on-chain for paymentId ${paymentId.slice(0, 18)}…` });
  const [, , , , isSettled] = (await c.escrow.getEscrowRecord(paymentId)) as [string, string, bigint, bigint, boolean, boolean];

  if (!isSettled) {
    return { success: false, error: "Escrow not marked settled after quittance post — unexpected state." };
  }

  // ── 7. Emit quittance receipt ─────────────────────────────────────────────
  await emit({
    kind: "quittance",
    receipt: {
      paymentId,
      seller:      args.sellerName,
      adapter:     cfg.proofType,
      amount:      fmt(amount),
      status:      "SETTLED",
      txHash:      settlement.quittanceTx,
      blockNumber: settlement.blockNumber,
    },
  });

  const successes = (await c.registry.successCount(sellerAA)) as bigint;

  return {
    success:     true,
    result:      settlement.result,
    paymentId,
    quittanceTx: settlement.quittanceTx,
    blockNumber: settlement.blockNumber,
    sellerSuccessCount: Number(successes),
    note: "Escrow settled and quittance posted on-chain. Buyer paid zero KITE in gas.",
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
              sellers, buyerEOA, buyerAA, sdk, provider,
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
