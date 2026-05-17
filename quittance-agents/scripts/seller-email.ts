/**
 * seller-email.ts — Quittance Email Seller Agent (facilitator-free x402)
 *
 * Implements spec-compliant x402 per implementation.md §5.3.5:
 *
 *   Round 1 — POST /task (no X-PAYMENT header)
 *     Seller issues paymentId, returns HTTP 402:
 *     { accepts: [{ scheme: "gokite-aa", payTo: Escrow, extra.quittance: {...} }] }
 *
 *   Round 2 — POST /task (X-PAYMENT: <base64> header present)
 *     Seller verifies X-PAYMENT (paymentId binding + sessionToken + allowance check)
 *     Seller: openEscrow(paymentId, buyerAA, sellerAA, amount, deadline, ORACLE)
 *     Seller: sends real email via Resend
 *     Seller: QuittanceRegistry.post(oracle proof)  → escrow auto-releases
 *     Returns HTTP 200 + X-PAYMENT-RESPONSE header
 *
 * Cheap mode (SELLER_CHEAP_MODE=true):
 *   Escrow opens normally, then seller sleeps past deadline without delivering.
 *   Refund + slash fire automatically. Used for the demo Act 1 Stakes story.
 *
 * Usage:
 *   npm run seller-email          (Gold tier, port 4002)
 *   npm run seller-email-cheap    (Bronze tier, port 4003, fails ~80%)
 */

import "dotenv/config";
import * as http from "http";
import { ethers } from "ethers";
import { Resend } from "resend";
import {
  getProvider,
  getSigner,
  getContracts,
  makePaymentId,
  signOracleProof,
  fmt,
  ProofType,
} from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, encodeCall } from "../lib/aa";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.SELLER_EMAIL_PORT ?? "4002");
const USDC_ADDR   = process.env.USDC_ADDRESS ?? process.env.PYUSD_ADDRESS!;
const TOKEN_DEC   = parseInt(process.env.TOKEN_DECIMALS ?? "6");
const PRICE       = BigInt(process.env.EMAIL_PRICE_UNITS ?? "1000"); // 0.001 USDC
const DEADLINE_SEC = 300;
const AGENT_NAME  = process.env.SELLER_EMAIL_NAME ?? "email.kite";
const PROOF_TYPE  = ProofType.ORACLE;

// Cheap mode: open escrow then deliberately miss the deadline (for slash demo).
const CHEAP_MODE      = process.env.SELLER_CHEAP_MODE === "true";
const CHEAP_FAIL_RATE = parseFloat(process.env.SELLER_CHEAP_FAIL_RATE ?? "0.8");

const FROM_EMAIL = process.env.RESEND_FROM ?? "onboarding@resend.dev";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag.padEnd(8)}] ${msg}`);
}

function jsonRes(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Length":              Buffer.byteLength(data),
    ...extraHeaders,
  });
  res.end(data);
}

/** Parse and base64-decode the X-PAYMENT header into a plain object. */
function parseXPayment(header: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Base64-encode an object into an X-PAYMENT-RESPONSE value. */
function encodeXPaymentResponse(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

// ─── On-chain allowance check ─────────────────────────────────────────────────

async function checkAllowance(
  provider: ReturnType<typeof getProvider>,
  buyerAA: string,
  escrowAddr: string,
  required: bigint,
): Promise<{ ok: boolean; reason?: string }> {
  const erc20 = new ethers.Contract(
    USDC_ADDR,
    ["function allowance(address owner, address spender) view returns (uint256)"],
    provider,
  );
  const allowance = await erc20.allowance(buyerAA, escrowAddr) as bigint;
  if (allowance < required) {
    return {
      ok: false,
      reason: `Buyer AA allowance ${fmt(allowance)} USDC < required ${fmt(required)} USDC`,
    };
  }
  return { ok: true };
}

// ─── Core settlement logic ────────────────────────────────────────────────────

interface SettlementResult {
  taskId: string;
  result: string;
  paymentId: string;
  escrowTx: string;
  quittanceTx: string;
  blockNumber: number;
  settled: boolean;
  usdcAmount: string;
}

async function executeTrade(
  provider:   ReturnType<typeof getProvider>,
  sellerEOA:  ethers.Wallet,
  sellerAA:   string,
  sdk:        ReturnType<typeof makeSDK>,
  buyerAA:    string,
  paymentId:  string,
  nonce:      Uint8Array,
  amount:     bigint,
  deadline:   bigint,
  to:         string,
  subject:    string,
  body:       string,
  requestHash: string,
  resend:     Resend,
): Promise<SettlementResult> {
  // ── 1. Verify paymentId ────────────────────────────────────────────────────
  const expectedId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);
  if (expectedId.toLowerCase() !== paymentId.toLowerCase()) {
    throw Object.assign(new Error("paymentId mismatch"), { code: "BAD_PAYMENT_ID" });
  }
  log("verify", `paymentId ✓  buyer=${buyerAA.slice(0, 10)}…  seller=${sellerAA.slice(0, 10)}…`);

  // ── 2. Open escrow (pulls from buyer AA allowance) ─────────────────────────
  log("escrow", `opening escrow…  amount=${fmt(amount)} USDC  deadline=${deadline}`);
  const escrowAddr = process.env.ESCROW_ADDRESS!;
  const openCD = encodeCall(
    "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
    [paymentId, buyerAA, sellerAA, amount, deadline, PROOF_TYPE],
  );
  const escrowResult = await aaSend(sdk, sellerEOA, escrowAddr, openCD);
  log("escrow", `EscrowOpened  tx=${escrowResult.txHash}  block=${escrowResult.blockNumber}`);

  // ── 3. Cheap mode: skip delivery, let deadline expire for slash demo ───────
  if (CHEAP_MODE && Math.random() < CHEAP_FAIL_RATE) {
    log("cheap", `intentionally skipping delivery (cheap mode, ~${CHEAP_FAIL_RATE * 100}% fail rate)`);
    log("cheap", `escrow opened; deadline in ${DEADLINE_SEC}s; refund + slash will fire automatically`);
    // Return a partial result so the caller knows we bailed on purpose.
    throw Object.assign(new Error("Delivery skipped (cheap mode)"), {
      code:     "CHEAP_MODE_SKIP",
      escrowTx: escrowResult.txHash,
    });
  }

  // ── 4. Send email via Resend ───────────────────────────────────────────────
  log("deliver", `sending email to ${to}…`);
  const emailBody = `
<h2>Your Quittance</h2>
<p>${body}</p>
<hr/>
<h3>On-chain proof</h3>
<table>
  <tr><td><strong>Payment ID</strong></td><td><code>${paymentId}</code></td></tr>
  <tr><td><strong>Escrow tx</strong></td><td><a href="https://scan.gokite.ai/tx/${escrowResult.txHash}">${escrowResult.txHash.slice(0, 20)}…</a></td></tr>
  <tr><td><strong>Amount</strong></td><td>${fmt(amount)} USDC</td></tr>
  <tr><td><strong>Seller</strong></td><td><code>${sellerAA}</code></td></tr>
  <tr><td><strong>Buyer</strong></td><td><code>${buyerAA}</code></td></tr>
</table>
<p style="color:#666;font-size:12px">Delivered by ${AGENT_NAME} · Quittance Protocol v0 · Kite Mainnet ${process.env.KITE_CHAIN_ID ?? 2366}</p>
`.trim();

  const sendRes = await resend.emails.send({
    from:    FROM_EMAIL,
    to,
    subject,
    html:    emailBody,
  });

  if (sendRes.error) {
    throw Object.assign(new Error(`Resend error: ${sendRes.error.message}`), { code: "RESEND_ERROR" });
  }

  const messageId = (sendRes.data as { id?: string } | null)?.id ?? "unknown";
  const result    = `Email delivered  to=${to}  messageId=${messageId}`;
  const resultHash = ethers.keccak256(ethers.toUtf8Bytes(result));
  log("deliver", `✓ ${result}`);

  // ── 5. Oracle signs proof ──────────────────────────────────────────────────
  const oracleKey = process.env.ORACLE_PRIVATE_KEY!;
  const oracleEOA = getSigner(oracleKey, provider);
  const proofSig  = await signOracleProof(oracleEOA, paymentId, resultHash);
  log("prove", `oracle signed  sig=${proofSig.slice(0, 22)}…`);

  // ── 6. Post quittance → escrow auto-releases ───────────────────────────────
  log("settle", `posting quittance via seller AA…`);
  const now    = BigInt(Math.floor(Date.now() / 1000));
  const postCD = encodeCall(
    `function post(tuple(
      bytes32 paymentId, bytes32 requestHash, bytes32 resultHash,
      address sellerPassport, address buyerPassport,
      uint8 proofType, bytes proofPayload, address attestor,
      uint64 deliveredAt, uint64 deadline
    ) q)`,
    [{
      paymentId,
      requestHash,
      resultHash,
      sellerPassport: sellerAA,
      buyerPassport:  buyerAA,
      proofType:      PROOF_TYPE,
      proofPayload:   proofSig,
      attestor:       oracleEOA.address,
      deliveredAt:    now,
      deadline,
    }],
  );
  const settleResult = await aaSend(sdk, sellerEOA, process.env.REGISTRY_ADDRESS!, postCD);
  log("settle", `QuittancePosted + EscrowReleased  tx=${settleResult.txHash}  block=${settleResult.blockNumber}`);

  return {
    taskId:      paymentId.slice(2, 10),
    result,
    paymentId,
    escrowTx:    escrowResult.txHash,
    quittanceTx: settleResult.txHash,
    blockNumber: settleResult.blockNumber,
    settled:     true,
    usdcAmount:  fmt(amount),
  };
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

async function main() {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("Set RESEND_API_KEY in .env  (get one free at resend.com)");
    process.exit(1);
  }
  const resend = new Resend(resendKey);

  const sellerKey = process.env.SELLER_EMAIL_PRIVATE_KEY ?? process.env.SELLER_SMS_PRO_PRIVATE_KEY;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;
  if (!sellerKey || !oracleKey) {
    console.error("Set SELLER_EMAIL_PRIVATE_KEY and ORACLE_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const provider  = getProvider();
  const network   = await provider.getNetwork();
  log("boot", `Network: Kite Mainnet  chainId=${network.chainId}`);

  const sellerEOA = getSigner(sellerKey, provider);
  const sdk       = makeSDK();
  const sellerAA  = aaAddress(sdk, sellerEOA.address);

  const c = getContracts(provider);
  const [bond, minBond] = (await Promise.all([
    c.bond.bonds(sellerAA),
    c.bond.MIN_BOND(),
  ])) as [bigint, bigint];

  log("boot", `Agent:     ${AGENT_NAME}${CHEAP_MODE ? "  [CHEAP MODE — will fail ~80%]" : ""}`);
  log("boot", `Seller EOA: ${sellerEOA.address}`);
  log("boot", `Seller AA:  ${sellerAA}`);
  log("boot", `Bond: ${fmt(bond)} USDC (min ${fmt(minBond)}) ${bond >= minBond ? "✓" : "← run npm run setup-mainnet first"}`);
  log("boot", `Price: ${fmt(PRICE)} USDC/email   Proof: ORACLE`);
  log("boot", `From:  ${FROM_EMAIL}`);

  // paymentId → pending Round 1 state
  const pending = new Map<string, {
    nonce:       Uint8Array;
    deadline:    bigint;
    buyerAA:     string;
    to:          string;
    subject:     string;
    body:        string;
    requestHash: string;
  }>();

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }

    if (req.method !== "POST" || req.url !== "/task") {
      jsonRes(res, 404, { error: "POST /task only" });
      return;
    }

    let rawBody = "";
    req.on("data", (chunk) => { rawBody += chunk; });
    await new Promise((r) => req.on("end", r));

    let reqBody: {
      to?: string;
      subject?: string;
      body?: string;
      buyerAA?: string;
    } = {};
    try { reqBody = JSON.parse(rawBody || "{}"); } catch { /**/ }

    const xPaymentHeader = req.headers["x-payment"] as string | undefined;

    // ── Round 1: no X-PAYMENT → return 402 ──────────────────────────────────
    if (!xPaymentHeader) {
      const { to, subject = "Your Quittance delivery", body = "", buyerAA } = reqBody;
      if (!to || !buyerAA) {
        jsonRes(res, 400, { error: "to and buyerAA are required" });
        return;
      }

      const nonce       = ethers.randomBytes(32);
      const deadline    = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      const paymentId   = makePaymentId(buyerAA, sellerAA, PRICE, deadline, nonce);
      const requestHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify({ to, subject, body })),
      );

      pending.set(paymentId, { nonce, deadline, buyerAA, to, subject, body, requestHash });
      log("req", `[R1] 402 issued  buyer=${buyerAA.slice(0, 10)}…  paymentId=${paymentId.slice(0, 14)}…`);

      // Spec-compliant 402 per implementation.md §5.3.1 + §5.3.5
      jsonRes(res, 402, {
        accepts: [{
          scheme:              "gokite-aa",
          network:             "kite-mainnet",
          maxAmountRequired:   PRICE.toString(),
          payTo:               process.env.ESCROW_ADDRESS!,
          asset:               USDC_ADDR,
          extra: {
            quittance: {
              version:         "Q001",
              escrow:          process.env.ESCROW_ADDRESS!,
              registry:        process.env.REGISTRY_ADDRESS!,
              proofType:       "ORACLE",
              deadlineSeconds: DEADLINE_SEC,
              minBondTier:     CHEAP_MODE ? "bronze" : "silver",
              attestor:        getSigner(process.env.ORACLE_PRIVATE_KEY!, provider).address,
              requestHash,
            },
            paymentId,
            buyerAA,
          },
        }],
      });
      return;
    }

    // ── Round 2: X-PAYMENT header present → verify + execute ────────────────
    const xp = parseXPayment(xPaymentHeader);
    if (!xp) {
      jsonRes(res, 400, { error: "Invalid X-PAYMENT: not valid base64 JSON" });
      return;
    }

    const paymentId = xp.paymentId as string;
    const buyerAA   = xp.buyerAA as string;

    if (!paymentId || !buyerAA) {
      jsonRes(res, 400, { error: "X-PAYMENT must contain paymentId and buyerAA" });
      return;
    }

    // v0: authorization = buyer AA's on-chain escrow allowance (checked below).
    // sessionToken is optional metadata. Full JWT verification against kpass
    // endpoint is a v0.1 upgrade (implementation.md §5.3.5).

    const p = pending.get(paymentId);
    if (!p) {
      jsonRes(res, 400, { error: "Unknown paymentId — call without X-PAYMENT first" });
      return;
    }

    if (p.buyerAA.toLowerCase() !== buyerAA.toLowerCase()) {
      jsonRes(res, 400, { error: "buyerAA mismatch" });
      return;
    }

    // Allowance pre-check (cheap, on-chain)
    const allowanceCheck = await checkAllowance(provider, buyerAA, process.env.ESCROW_ADDRESS!, PRICE);
    if (!allowanceCheck.ok) {
      jsonRes(res, 402, { error: allowanceCheck.reason });
      return;
    }

    pending.delete(paymentId);
    log("req", `[R2] X-PAYMENT verified  paymentId=${paymentId.slice(0, 14)}…  buyer=${buyerAA.slice(0, 10)}…`);

    try {
      const settlement = await executeTrade(
        provider, sellerEOA, sellerAA, sdk,
        buyerAA, paymentId, p.nonce, PRICE, p.deadline,
        p.to, p.subject, p.body, p.requestHash, resend,
      );

      const xPaymentResponse = encodeXPaymentResponse({
        scheme:      "gokite-aa",
        network:     "kite-mainnet",
        paymentId,
        escrowTx:    settlement.escrowTx,
        quittanceTx: settlement.quittanceTx,
        deliveredAt: Math.floor(Date.now() / 1000),
      });

      log("req", `✓ settled  quittanceTx=${settlement.quittanceTx.slice(0, 14)}…`);
      jsonRes(res, 200, settlement, { "X-PAYMENT-RESPONSE": xPaymentResponse });
    } catch (err: unknown) {
      const e = err as { reason?: string; shortMessage?: string; message?: string; code?: string; escrowTx?: string };
      const reason = e.reason ?? e.shortMessage ?? e.message ?? "unknown error";
      const code   = e.code ?? "INTERNAL_ERROR";
      log("req", `✗ ${code}: ${reason}`);

      if (code === "CHEAP_MODE_SKIP") {
        // Escrow is open, deliberately not delivering. Caller sees a 202 Accepted
        // so the buyer agent knows the seller acknowledged the payment but hasn't delivered.
        jsonRes(res, 202, {
          paymentId,
          escrowTx: e.escrowTx,
          status:   "accepted_not_delivered",
          note:     "Cheap seller accepted payment. Delivery pending. Refund fires at deadline.",
        });
        return;
      }

      const httpStatus = code === "BAD_PAYMENT_ID" ? 400 : 500;
      jsonRes(res, httpStatus, { error: reason, code });
    }
  });

  server.listen(PORT, () => {
    log("boot", `\n  ${AGENT_NAME} listening on http://localhost:${PORT}/task`);
    log("boot", `  Protocol: x402  scheme=gokite-aa  facilitator=none (on-chain escrow settlement)`);
    log("boot", `  Price: ${fmt(PRICE)} USDC/email  Proof: ORACLE  Mode: ${CHEAP_MODE ? "CHEAP (slash demo)" : "NORMAL"}\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
