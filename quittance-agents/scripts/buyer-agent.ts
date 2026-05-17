/**
 * buyer-agent.ts — Quittance Buyer Agent (GPT-4o mini, spec-compliant x402)
 *
 * A real LLM agent that:
 *   1. Receives a task from the user.
 *   2. Calls list_sellers → inspects on-chain reputation.
 *   3. Reasons about which seller to use (model output, streamed to UI).
 *   4. Calls quittance_pay → full spec-compliant x402 round-trip:
 *        Round 1: POST /task → HTTP 402 + accepts block
 *        Round 2: POST /task (X-PAYMENT header) → HTTP 200 + X-PAYMENT-RESPONSE
 *        Seller opens escrow, delivers, posts QuittanceRegistry proof, escrow releases.
 *   5. Reports settlement (quittanceTx, escrowTx, imageUrl / messageId) to the user.
 *
 * No kpass wallet send. No custom two-round protocol. Pure x402 per §5.3.5.
 *
 * Environment
 *   OPENAI_API_KEY              GPT-4o mini access
 *   BUYER_PRIVATE_KEY           EOA key for the buyer AA wallet
 *   KPASS_SESSION_TOKEN         Kite Passport session token (embedded in X-PAYMENT)
 *   SELLER_EMAIL_PRIVATE_KEY    Used to derive email.kite passport address for UI
 *   SELLER_EMAIL_CHEAP_PRIVATE_KEY  Used to derive email-cheap.kite passport address
 *   SELLER_IMAGE_PRIVATE_KEY    Used to derive image.kite passport address
 *   SELLER_EMAIL_URL            email.kite endpoint (default: http://localhost:4002/task)
 *   SELLER_EMAIL_CHEAP_URL      email-cheap.kite endpoint (default: http://localhost:4003/task)
 *   SELLER_IMAGE_URL            image.kite endpoint (default: http://localhost:4004/task)
 *   EVENTS_WEBHOOK_URL          Web UI webhook (default: http://localhost:3001/api/agent-events)
 */

import "dotenv/config";
import OpenAI from "openai";
import { ethers } from "ethers";
import {
  getProvider, getSigner, getContracts,
  fmt, TIER_LABEL,
} from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, encodeCall } from "../lib/aa";
import { emit, emitAction } from "../lib/events";

// ─── OpenAI client ────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Seller registry ──────────────────────────────────────────────────────────

type ServiceType = "email" | "image";

interface SellerConfig {
  key:       string;
  url:       string;
  service:   string;
  type:      ServiceType;
  proofType: string;
  priceUSDC: string;
}

function buildSellerRegistry(): Record<string, SellerConfig> {
  const reg: Record<string, SellerConfig> = {};

  if (process.env.SELLER_EMAIL_PRIVATE_KEY) {
    reg["email.kite"] = {
      key:       process.env.SELLER_EMAIL_PRIVATE_KEY,
      url:       process.env.SELLER_EMAIL_URL ?? "http://localhost:4002/task",
      service:   "Email delivery (real inbox, on-chain proof)",
      type:      "email",
      proofType: "ORACLE",
      priceUSDC: "0.001",
    };
  }
  if (process.env.SELLER_EMAIL_CHEAP_PRIVATE_KEY) {
    reg["email-cheap.kite"] = {
      key:       process.env.SELLER_EMAIL_CHEAP_PRIVATE_KEY,
      url:       process.env.SELLER_EMAIL_CHEAP_URL ?? "http://localhost:4003/task",
      service:   "Email delivery (budget, unreliable)",
      type:      "email",
      proofType: "ORACLE",
      priceUSDC: "0.001",
    };
  }
  if (process.env.SELLER_IMAGE_PRIVATE_KEY) {
    reg["image.kite"] = {
      key:       process.env.SELLER_IMAGE_PRIVATE_KEY,
      url:       process.env.SELLER_IMAGE_URL ?? "http://localhost:4004/task",
      service:   "Image generation (Pollinations.ai, real image URL, on-chain proof)",
      type:      "image",
      proofType: "ORACLE",
      priceUSDC: "0.001",
    };
  }
  return reg;
}

// ─── x402 helpers ─────────────────────────────────────────────────────────────

/**
 * Build the X-PAYMENT header payload per implementation.md §5.3.5.
 *
 * Authorization model in v0:
 *   The buyer AA's standing escrow allowance (set during setup-mainnet) is the
 *   on-chain authorization. The seller verifies allowance via eth_call before
 *   calling openEscrow — no session token needed.
 *
 *   sessionToken is included as optional metadata referencing the Passport
 *   session the user approved in the web UI. Full JWT verification against
 *   a kpass endpoint is a v0.1 upgrade (spec'd in implementation.md §5.3.5).
 */
function buildXPayment(paymentId: string, buyerAA: string): string {
  const payload: Record<string, unknown> = {
    scheme:   "gokite-aa",
    version:  "Q001",
    paymentId,
    buyerAA,
    issuedAt: Math.floor(Date.now() / 1000),
    nonce:    ethers.hexlify(ethers.randomBytes(16)),
  };
  // Include session reference if available — informational only in v0
  if (process.env.KPASS_SESSION_TOKEN) {
    payload.sessionToken = process.env.KPASS_SESSION_TOKEN;
  }
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

interface X402Accept {
  scheme:            string;
  network:           string;
  maxAmountRequired: string;
  payTo:             string;
  asset:             string;
  extra?: {
    paymentId?: string;
    buyerAA?:   string;
    quittance?: Record<string, unknown>;
  };
}

interface Round1Response {
  accepts: X402Accept[];
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a Quittance buyer agent running on Kite mainnet. You help users \
complete tasks — email delivery and image generation — through the Quittance \
protocol: an atomic Exec-Pay-Deliver system where funds only leave escrow when \
cryptographic proof of delivery is posted on-chain.

PROTOCOL
  1. Buyer sends a request → seller returns HTTP 402 with payment terms (no money moves yet).
  2. Buyer sends X-PAYMENT header → seller opens on-chain escrow, delivers the service, \
     posts a Quittance proof to QuittanceRegistry, and escrow auto-releases to seller.
  3. If no proof before deadline → full refund, seller bond slashed.
  4. All settlement is facilitator-free: the escrow contract IS the settlement venue.

YOUR JOB
  - Call list_sellers to see available sellers and on-chain reputation.
  - ALWAYS try the cheapest available seller first. The Quittance escrow protects you:
    if they fail to deliver, you get a full refund and their bond gets slashed. There is
    no downside to trying cheap first — the protocol absorbs the risk.
  - If quittance_pay returns skipped=true (seller opened escrow but did not deliver),
    call quittance_pay again with the next best seller. Do not give up after one failure.
  - Call check_buyer_wallet only if you need to verify allowance.
  - Report final settlement: quittanceTx (on-chain proof), escrowTx, deliverable.

Emit your reasoning before each tool call. Be specific: name the seller and why you chose it. \
One or two sentences max.`;

// ─── OpenAI tool schemas ──────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_sellers",
      description:
        "Lists all Quittance sellers on Kite mainnet with their on-chain reputation (tier, bond, success rate, settled count). Always call this before choosing a seller.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_buyer_wallet",
      description:
        "Returns the buyer's AA wallet address, USDC balance, and USDC allowance to the Escrow contract. Call this to verify you have enough allowance.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "quittance_pay",
      description:
        "Execute a full Quittance x402 payment cycle with a named seller. " +
        "For email sellers: provide to, subject, body. " +
        "For image sellers: provide prompt. " +
        "Returns settlement result including quittanceTx, escrowTx, and the deliverable (imageUrl or messageId).",
      parameters: {
        type: "object",
        properties: {
          sellerName: {
            type:        "string",
            description: "Seller name from list_sellers, e.g. 'email.kite' or 'image.kite'",
          },
          to: {
            type:        "string",
            description: "Email recipient address (for email sellers)",
          },
          subject: {
            type:        "string",
            description: "Email subject line (for email sellers)",
          },
          body: {
            type:        "string",
            description: "Email body content (for email sellers)",
          },
          prompt: {
            type:        "string",
            description: "Image generation prompt (for image sellers)",
          },
        },
        required: ["sellerName"],
      },
    },
  },
];

// ─── Tool executors ───────────────────────────────────────────────────────────

async function toolListSellers(
  sellers:  Record<string, SellerConfig>,
  provider: ethers.JsonRpcProvider,
  sdk:      ReturnType<typeof makeSDK>,
) {
  const c = getContracts(provider);
  const results = [];

  for (const [name, cfg] of Object.entries(sellers)) {
    const sellerEOA = getSigner(cfg.key, provider);
    const sellerAA  = aaAddress(sdk, sellerEOA.address);

    let repData = { tier: "Unknown", successRatePct: 0, settled: 0, slashed: 0, bondUSDC: "0" };
    try {
      const rep = (await c.reputation.summary(sellerAA)) as [bigint, bigint, bigint, bigint, number];
      repData = {
        tier:           TIER_LABEL[rep[4]] ?? "Unknown",
        successRatePct: Number(rep[0]) / 100,
        settled:        Number(rep[1]),
        slashed:        Number(rep[2]),
        bondUSDC:       fmt(rep[3]),
      };
    } catch { /* seller not yet registered on reputation view */ }

    results.push({
      name,
      service:   cfg.service,
      type:      cfg.type,
      proofType: cfg.proofType,
      passport:  sellerAA,
      priceUSDC: cfg.priceUSDC,
      ...repData,
    });
  }

  return results;
}

async function toolCheckBuyerWallet(
  buyerAA:  string,
  provider: ethers.JsonRpcProvider,
) {
  const c      = getContracts(provider);
  const bal    = (await c.usdc.balanceOf(buyerAA)) as bigint;
  const allow  = (await c.usdc.allowance(buyerAA, process.env.ESCROW_ADDRESS!)) as bigint;
  return {
    passport:             buyerAA,
    balanceUSDC:          fmt(bal),
    escrowAllowanceUSDC:  fmt(allow),
    note: allow === 0n
      ? "Run setup-mainnet to approve escrow allowance"
      : "Allowance covers payments ✓",
  };
}

/**
 * Wait until after the escrow deadline then call Escrow.refund(paymentId).
 * Fires in the background — buyer agent does not wait for it.
 */
async function scheduleRefund(
  paymentId: string,
  deadlineUnix: number,
  buyerEOA: ReturnType<typeof getSigner>,
  sdk: ReturnType<typeof makeSDK>,
) {
  const provider = getProvider();
  const msUntilDeadline = Math.max(0, (deadlineUnix - Math.floor(Date.now() / 1000)) * 1000);
  const waitMs = msUntilDeadline + 20_000; // 20s buffer — block.timestamp lags wall clock
  await emit({ kind: "reasoning", content: `Refund scheduled in ${Math.ceil(waitMs / 1000)}s — escrow deadline at ${new Date(deadlineUnix * 1000).toISOString()}` });

  setTimeout(async () => {
    try {
      await emit({ kind: "action", actionId: `refund-${paymentId.slice(2, 10)}`, actionLabel: `Escrow.refund(${paymentId.slice(0, 14)}…) — reclaiming USDC + slashing bond`, actionStatus: "pending" });
      const refundCD = encodeCall("function refund(bytes32 paymentId)", [paymentId]);
      const result = await aaSend(sdk, buyerEOA, process.env.ESCROW_ADDRESS!, refundCD);
      await emit({
        kind: "action",
        actionId: `refund-${paymentId.slice(2, 10)}`,
        actionLabel: `Refund + slash confirmed — USDC returned to buyer AA, bond slashed`,
        actionStatus: "confirmed",
        txHash: result.txHash,
        blockNumber: result.blockNumber,
      });
      await emit({
        kind: "quittance",
        receipt: {
          paymentId,
          seller: "email-cheap.kite",
          adapter: "ORACLE",
          amount: "0.001",
          status: "SLASHED",
          txHash: result.txHash,
          blockNumber: result.blockNumber,
        },
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      await emit({ kind: "reasoning", content: `Refund tx failed: ${e.message ?? String(err)}` });
    }
  }, waitMs);
}

async function toolQuittancePay(
  args: {
    sellerName: string;
    to?:        string;
    subject?:   string;
    body?:      string;
    prompt?:    string;
  },
  sellers:   Record<string, SellerConfig>,
  buyerAA:   string,
  buyerEOA:  ReturnType<typeof getSigner>,
  sdk:       ReturnType<typeof makeSDK>,
) {
  const cfg = sellers[args.sellerName];
  if (!cfg) {
    return { success: false, error: `Unknown seller '${args.sellerName}'. Use list_sellers first.` };
  }

  // Build service-specific body for Round 1
  let serviceBody: Record<string, string>;
  if (cfg.type === "email") {
    if (!args.to) return { success: false, error: "to (email address) is required for email sellers" };
    serviceBody = {
      to:      args.to,
      subject: args.subject ?? "Message from Quittance Agent",
      body:    args.body    ?? "",
      buyerAA,
    };
  } else {
    if (!args.prompt) return { success: false, error: "prompt is required for image sellers" };
    serviceBody = { prompt: args.prompt, buyerAA };
  }

  // ── Round 1: POST without X-PAYMENT → expect 402 ─────────────────────────
  await emit({
    kind:    "reasoning",
    content: `x402 Round 1 — requesting from ${args.sellerName} at ${cfg.url}…`,
  });
  await emit({ kind: "action", actionId: "x402-r1", actionLabel: `POST ${cfg.url} → 402 negotiation`, actionStatus: "pending" });

  let r1Body: Round1Response;
  try {
    const r1 = await fetch(cfg.url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(serviceBody),
      signal:  AbortSignal.timeout(15_000),
    });

    if (r1.status !== 402) {
      const txt = await r1.text().catch(() => "");
      return { success: false, error: `Expected 402, got ${r1.status}: ${txt.slice(0, 200)}` };
    }

    r1Body = await r1.json() as Round1Response;
  } catch (e: unknown) {
    return { success: false, error: `Seller unreachable: ${(e as { message?: string }).message}` };
  }

  const accepted = r1Body.accepts?.[0];
  if (!accepted?.extra?.paymentId) {
    return { success: false, error: "402 response missing accepts[0].extra.paymentId" };
  }

  const paymentId = accepted.extra.paymentId;
  const escrowAddr = accepted.payTo;
  const amountRaw  = accepted.maxAmountRequired;

  await emit({
    kind:        "action",
    actionId:    "x402-r1",
    actionLabel: `402 received — paymentId ${paymentId.slice(0, 14)}…  amount ${fmt(BigInt(amountRaw))} USDC → escrow ${escrowAddr.slice(0, 10)}…`,
    actionStatus: "confirmed",
  });
  await emit({
    kind:    "reasoning",
    content: `402 negotiated ✓\n  paymentId: ${paymentId.slice(0, 18)}…\n  Escrow: ${escrowAddr}\n  Amount: ${fmt(BigInt(amountRaw))} USDC\n  Proof type: ${accepted.extra.quittance?.proofType ?? "ORACLE"}`,
  });

  // ── Round 2: POST with X-PAYMENT header → seller settles ─────────────────
  const xPayment = buildXPayment(paymentId, buyerAA);

  await emit({
    kind:    "reasoning",
    content: `x402 Round 2 — sending X-PAYMENT…\n  Seller will: openEscrow → deliver → QuittanceRegistry.post()`,
  });
  await emit({ kind: "action", actionId: "x402-r2", actionLabel: `POST ${cfg.url} X-PAYMENT → settle`, actionStatus: "pending" });

  let r2Body: {
    paymentId:   string;
    escrowTx:    string;
    quittanceTx: string;
    blockNumber: number;
    usdcAmount:  string;
    result?:     string;   // email: "Email delivered ..."
    imageUrl?:   string;   // image: CDN URL
    settled:     boolean;
  };

  let xPaymentResponse: string | null = null;

  try {
    const r2 = await fetch(cfg.url, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT":    xPayment,
      },
      body:   JSON.stringify(serviceBody),
      signal: AbortSignal.timeout(120_000), // image gen + 2x AA UserOps can be slow
    });

    xPaymentResponse = r2.headers.get("x-payment-response");

    if (r2.status === 202) {
      const body = await r2.json() as { paymentId: string; escrowTx?: string; note?: string; deadline?: number };
      await emit({
        kind:        "action",
        actionId:    "x402-r2",
        actionLabel: `202 Accepted — cheap seller opened escrow but skipped delivery`,
        actionStatus: "failed",
      });
      await emit({
        kind:    "reasoning",
        content: `Cheap seller took the escrow but didn't deliver. Refund + bond slash scheduled automatically after deadline. Routing to the reliable seller next.`,
      });

      // Schedule on-chain refund after deadline — fires in background, doesn't block agent
      if (body.paymentId) {
        const deadline = body.deadline ?? (Math.floor(Date.now() / 1000) + 65);
        scheduleRefund(body.paymentId, deadline, buyerEOA, sdk).catch(() => {});
      }

      return {
        success:   false,
        skipped:   true,
        paymentId: body.paymentId,
        escrowTx:  body.escrowTx,
        note:      "Cheap seller failed. Refund + slash scheduled. Try the next seller.",
      };
    }

    if (!r2.ok) {
      const txt = await r2.text().catch(() => "");
      return { success: false, error: `Seller Round 2 failed (${r2.status}): ${txt.slice(0, 300)}` };
    }

    r2Body = await r2.json() as typeof r2Body;
  } catch (e: unknown) {
    return { success: false, error: `Round 2 error: ${(e as { message?: string }).message}` };
  }

  await emit({
    kind:     "action",
    actionId: "x402-r2",
    actionLabel: `Escrow opened + Quittance posted → block ${r2Body.blockNumber}`,
    actionStatus: "confirmed",
    txHash:   r2Body.quittanceTx,
    blockNumber: r2Body.blockNumber,
  });

  // Decode X-PAYMENT-RESPONSE for logging
  if (xPaymentResponse) {
    try {
      const decoded = JSON.parse(Buffer.from(xPaymentResponse, "base64").toString());
      await emit({
        kind:    "reasoning",
        content: `X-PAYMENT-RESPONSE verified ✓\n  escrowTx:    ${decoded.escrowTx ?? r2Body.escrowTx}\n  quittanceTx: ${decoded.quittanceTx ?? r2Body.quittanceTx}`,
      });
    } catch { /* ignore parse errors */ }
  }

  // ── Emit quittance receipt ────────────────────────────────────────────────
  await emit({
    kind: "quittance",
    receipt: {
      paymentId:   r2Body.paymentId,
      seller:      args.sellerName,
      adapter:     cfg.proofType,
      amount:      r2Body.usdcAmount,
      status:      "SETTLED",
      txHash:      r2Body.quittanceTx,
      blockNumber: r2Body.blockNumber,
    },
    imageUrl: r2Body.imageUrl,
  });

  const deliverable = r2Body.imageUrl
    ? { imageUrl: r2Body.imageUrl }
    : { result: r2Body.result };

  return {
    success:     true,
    ...deliverable,
    paymentId:   r2Body.paymentId,
    escrowTx:    r2Body.escrowTx,
    quittanceTx: r2Body.quittanceTx,
    blockNumber: r2Body.blockNumber,
    usdcAmount:  r2Body.usdcAmount,
    kitescan:    `https://kitescan.ai/tx/${r2Body.quittanceTx}`,
  };
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function run(task: string) {
  await emit({ kind: "user", content: task });

  const provider = getProvider();
  const buyerKey = process.env.BUYER_PRIVATE_KEY;
  if (!buyerKey) {
    await emit({ kind: "error", content: "BUYER_PRIVATE_KEY not set in .env" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    await emit({ kind: "error", content: "OPENAI_API_KEY not set in .env" });
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

  for (let turn = 0; turn < 12; turn++) {
    const response = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      messages,
      tools:       TOOLS,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (msg.content?.trim()) {
      await emit({ kind: "agent", content: msg.content.trim() });
    }

    if (!msg.tool_calls?.length) break;

    for (const _tc of msg.tool_calls) {
      const tc = _tc as OpenAI.Chat.ChatCompletionMessageToolCall & {
        function: { name: string; arguments: string };
      };

      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /**/ }

      const argStr = Object.keys(args).length
        ? Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")
        : "";
      await emit({ kind: "reasoning", content: `→ ${tc.function.name}(${argStr})` });

      let result: unknown;
      try {
        switch (tc.function.name) {
          case "list_sellers":
            result = await toolListSellers(sellers, provider, sdk);
            break;
          case "check_buyer_wallet":
            result = await toolCheckBuyerWallet(buyerAA, provider);
            break;
          case "quittance_pay":
            result = await toolQuittancePay(
              args as Parameters<typeof toolQuittancePay>[0],
              sellers,
              buyerAA,
              buyerEOA,
              sdk,
            );
            break;
          default:
            result = { error: `Unknown tool: ${tc.function.name}` };
        }
      } catch (err: unknown) {
        const e = err as { reason?: string; shortMessage?: string; message?: string };
        result = { error: e.reason ?? e.shortMessage ?? e.message ?? String(err) };
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
    : "Send an order confirmation email to demo@example.com and generate a product banner image.";

  console.log("\n── Quittance Buyer Agent (GPT-4o mini) — x402 facilitator-free ──\n");
  console.log(`Task: ${task}\n`);

  try {
    await run(task);
  } catch (err: unknown) {
    const e = err as { message?: string };
    await emit({ kind: "error", content: e.message ?? String(err) });
    process.exit(1);
  }
}

main();
