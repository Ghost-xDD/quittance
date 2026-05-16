/**
 * buyer-agent.ts — Quittance Buyer Agent
 *
 * A reasoning buyer agent that:
 *   1. Queries on-chain seller reputation to choose a provider.
 *   2. Makes an x402 HTTP call — receives a 402 payment challenge.
 *   3. Opens Escrow approval via AA (gasless UserOp) if not already approved.
 *   4. Retries the request with X-Payment-* auth headers.
 *   5. Receives settlement confirmation + verifies quittance on-chain.
 *   6. Streams structured AgentEvents to the web UI SSE endpoint.
 *
 * Usage:  npm run buyer-agent [-- --task "send SMS to +1-555-0192"]
 *
 * Environment
 *   BUYER_PRIVATE_KEY          EOA key for the buyer passport
 *   SELLER_SMS_PRO_PRIVATE_KEY EOA key to derive seller passport address
 *   SELLER_URL                 Seller HTTP endpoint (default: http://localhost:4001/task)
 *   EVENTS_WEBHOOK_URL         Web UI webhook (default: http://localhost:3001/api/agent-events)
 */

import "dotenv/config";
import { ethers } from "ethers";
import { getProvider, getSigner, getContracts, makePaymentId, fmt } from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, encodeCall } from "../lib/aa";
import { buildPaymentHeaders } from "../lib/x402";
import { emit, emitAction } from "../lib/events";
import type { X402Challenge, X402Settlement } from "../lib/x402";

// ─── Config ───────────────────────────────────────────────────────────────────

const SELLER_URL   = process.env.SELLER_URL ?? "http://localhost:4001/task";
const MAX_APPROVE  = ethers.parseUnits("10", 18); // pre-approve 10 PYUSD for multiple cycles

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function mkId()            { return Math.random().toString(36).slice(2, 10); }

async function postJSON<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify(body),
  });
  const data = await res.json() as T;
  return { status: res.status, data };
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function run(task: string) {
  await emit({ kind: "user", content: task });

  const provider = getProvider();
  const network  = await provider.getNetwork();

  // ── Passports ───────────────────────────────────────────────────────────────
  const buyerKey  = process.env.BUYER_PRIVATE_KEY!;
  const sellerKey = process.env.SELLER_SMS_PRO_PRIVATE_KEY!;
  if (!buyerKey || !sellerKey) {
    await emit({ kind: "error", content: "BUYER_PRIVATE_KEY / SELLER_SMS_PRO_PRIVATE_KEY not set" });
    return;
  }

  const buyerEOA  = getSigner(buyerKey, provider);
  const sellerEOA = getSigner(sellerKey, provider);
  const sdk       = makeSDK();
  const buyerAA   = aaAddress(sdk, buyerEOA.address);
  const sellerAA  = aaAddress(sdk, sellerEOA.address);

  // ── Reasoning: provider selection ───────────────────────────────────────────
  const c = getContracts(provider);
  const [rep] = (await Promise.all([
    c.reputation.summary(sellerAA),
  ])) as [readonly [bigint, bigint, bigint, bigint, number]];

  const successBps = rep[0];
  const settled    = rep[1];
  const activeBond = rep[3];
  const tierNum    = rep[4];
  const tierLabel  = ["Bronze", "Silver", "Gold"][tierNum] ?? "Unknown";

  await emit({
    kind: "reasoning",
    content: `Querying QuittanceRegistry for SMS sellers on Kite testnet (chainId=${network.chainId})…`,
  });
  await sleep(300);
  await emit({
    kind: "reasoning",
    content: `Found sms.kite — ${tierLabel} tier, ${Number(successBps) / 100}% success rate, ${fmt(activeBond)} PYUSD bond, ${settled} completed quittances.`,
  });
  await sleep(300);
  await emit({
    kind: "reasoning",
    content: `sms.kite selected. Bond (${fmt(activeBond)} PYUSD) far exceeds payment (0.001 PYUSD). If delivery fails, bond is slashable and I get refunded. Risk is bounded.`,
  });
  await sleep(200);

  // ── Step 1: Ensure buyer AA has approved Escrow ──────────────────────────────
  const allowance = (await c.pyusd.allowance(buyerAA, process.env.ESCROW_ADDRESS!)) as bigint;
  const pyusdBal  = (await c.pyusd.balanceOf(buyerAA)) as bigint;

  await emit({
    kind: "reasoning",
    content: `Buyer passport ${buyerAA.slice(0,10)}… has ${fmt(pyusdBal)} PYUSD. Escrow allowance: ${fmt(allowance)}.`,
  });

  // Auto-fund buyer AA from EOA if balance is low (EOA is the source of truth)
  if (pyusdBal < ethers.parseUnits("0.001", 18)) {
    const eoa_bal = (await c.pyusd.balanceOf(buyerEOA.address)) as bigint;
    const topUp   = ethers.parseUnits("0.01", 18); // fund 10× the payment amount
    if (eoa_bal < topUp) {
      // Try to pull from seller/deployer EOA as emergency fallback
      const sellerEOAPyusd = (await c.pyusd.balanceOf(sellerEOA.address)) as bigint;
      if (sellerEOAPyusd >= topUp) {
        await emit({ kind: "reasoning", content: `Buyer EOA also low — topping up buyer AA from seller/deployer EOA (${fmt(topUp)} PYUSD)…` });
        const tx = await (c.pyusd.connect(sellerEOA) as typeof c.pyusd).transfer(buyerAA, topUp);
        await tx.wait();
      } else {
        await emit({ kind: "error", content: `Buyer AA has ${fmt(pyusdBal)} PYUSD and no EOA source to top up from. Fund ${buyerAA} with PYUSD first.` });
        return;
      }
    } else {
      await emit({ kind: "reasoning", content: `Buyer AA is out of PYUSD — transferring ${fmt(topUp)} from buyer EOA → buyer AA…` });
      const tx = await (c.pyusd.connect(buyerEOA) as typeof c.pyusd).transfer(buyerAA, topUp);
      await tx.wait();
    }
    await emit({ kind: "reasoning", content: `Buyer AA topped up. Continuing with payment.` });
  }

  if (allowance < ethers.parseUnits("0.001", 18)) {
    await emit({
      kind: "reasoning",
      content: `Allowance insufficient — submitting PYUSD.approve(Escrow, 10 PYUSD) via AA UserOperation (gasless).`,
    });

    const approveCD = encodeCall(
      "function approve(address spender, uint256 amount) returns (bool)",
      [process.env.ESCROW_ADDRESS!, MAX_APPROVE],
    );
    const result = await emitAction("approve-escrow", "PYUSD.approve(Escrow, 10 PYUSD)", async () => {
      return aaSend(sdk, buyerEOA, process.env.PYUSD_ADDRESS!, approveCD);
    });
    await emit({
      kind: "action",
      actionId: "approve-escrow",
      actionLabel: "PYUSD.approve(Escrow, 10 PYUSD)",
      actionStatus: "confirmed",
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      userOpHash: result.userOpHash,
    });
  } else {
    await emit({
      kind: "reasoning",
      content: `Escrow allowance already sufficient (${fmt(allowance)} PYUSD) — no approval needed.`,
    });
  }

  // ── Step 2: x402 round 1 — get payment challenge ────────────────────────────
  await emit({
    kind: "reasoning",
    content: `Initiating x402 request → ${SELLER_URL} (no payment yet — expect 402 challenge)…`,
  });

  const to = task.match(/\+[\d\s\-().]+/)?.at(0)?.trim() ?? "+1-555-0192";
  const { status: s1, data: d1 } = await postJSON<X402Challenge | { error: string }>(SELLER_URL, { to, message: task });

  if (s1 !== 402) {
    await emit({ kind: "error", content: `Expected 402 but got ${s1}: ${JSON.stringify(d1)}` });
    return;
  }

  const challenge = d1 as X402Challenge;
  await emit({
    kind: "reasoning",
    content: `402 Payment Required. Seller passport: ${challenge.sellerPassport.slice(0,10)}…  Amount: ${fmt(BigInt(challenge.amount))} PYUSD  Deadline: T+${challenge.deadlineOffset}s.`,
  });

  // ── Step 3: Construct paymentId + payment auth ────────────────────────────────
  const block    = await provider.getBlock("latest");
  const deadline = BigInt(block!.timestamp) + BigInt(challenge.deadlineOffset);
  const amount   = BigInt(challenge.amount);
  const nonce    = ethers.randomBytes(32);
  const paymentId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);

  await emit({
    kind: "reasoning",
    content: `Constructing paymentId: keccak256(buyerAA, sellerAA, ${fmt(amount)} PYUSD, T+${challenge.deadlineOffset}s, nonce).\n  paymentId = ${paymentId}`,
  });

  const paymentHeaders = buildPaymentHeaders(paymentId, nonce, buyerAA, amount, deadline);

  await emit({
    kind: "agent",
    content: `Sending payment authorisation to sms.kite. The seller will open escrow (pulling ${fmt(amount)} PYUSD from my passport), deliver the SMS, and post an ORACLE quittance — at which point escrow releases. If no proof appears before the deadline, I can reclaim my PYUSD.`,
  });

  // ── Step 4: x402 round 2 — send payment headers ──────────────────────────────
  await emit({ kind: "reasoning", content: `Retrying POST with X-Payment-* headers…` });

  const { status: s2, data: d2 } = await postJSON<X402Settlement | { error: string; code?: string }>(
    SELLER_URL,
    { to, message: task },
    paymentHeaders,
  );

  if (s2 !== 200) {
    const err = d2 as { error: string; code?: string };
    if (err.code === "INSUFFICIENT_ALLOWANCE") {
      await emit({ kind: "error", content: `Seller rejected: buyer allowance too low. Run npm run integration first to pre-approve.` });
    } else if (err.code === "INSUFFICIENT_BALANCE") {
      await emit({ kind: "error", content: `Seller rejected: ${err.error}` });
    } else {
      await emit({ kind: "error", content: `Seller error ${s2}: ${err.error}` });
    }
    return;
  }

  const settlement = d2 as X402Settlement;

  // ── Step 5: Verify on-chain ────────────────────────────────────────────────
  await emit({ kind: "reasoning", content: `Settlement claimed. Verifying escrow.settled on-chain…` });

  const [, , , , settled1] = (await c.escrow.getEscrowRecord(paymentId)) as [string, string, bigint, bigint, boolean, boolean];
  const successes = (await c.registry.successCount(sellerAA)) as bigint;

  // ── Step 6: Emit quittance ─────────────────────────────────────────────────
  if (settled1) {
    await emit({
      kind: "quittance",
      receipt: {
        paymentId,
        seller:    "sms.kite",
        adapter:   "ORACLE",
        amount:    fmt(amount),
        status:    "SETTLED",
        txHash:    settlement.quittanceTx,
        blockNumber: settlement.blockNumber,
      },
    });
    await emit({
      kind: "agent",
      content: `Done. "${settlement.result}" — verified on-chain at block ${settlement.blockNumber}. sms.kite now has ${successes} successful quittances on record. I paid zero KITE in gas.`,
    });
  } else {
    await emit({ kind: "error", content: `Escrow not settled after quittance post — unexpected state.` });
  }

  await emit({ kind: "done" });
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const taskIdx = args.indexOf("--task");
  const task = taskIdx >= 0 ? args[taskIdx + 1] : "Send an SMS alert to +1-555-0192 about a KITE price movement.";

  console.log("\n── Quittance Buyer Agent ─────────────────────────────────\n");
  console.log(`Task: ${task}\n`);

  try {
    await run(task);
  } catch (err: any) {
    await emit({ kind: "error", content: err.message ?? String(err) });
    process.exit(1);
  }
}

main();
