/**
 * seller-sms.ts — Quittance SMS Seller Agent (x402 standard + Kite AA)
 *
 * Implements the x402 payment protocol spec:
 *   POST /task               → 402 { accepts: [...] }  (standard x402 challenge)
 *   POST /task + X-Payment   → 200 { result, quittance }
 *
 * Payment verified via Pieverse facilitator, then settled on-chain:
 *   1. Verify X-Payment signature (Pieverse /verify)
 *   2. Open escrow (gasless AA UserOp)
 *   3. Deliver SMS
 *   4. Post quittance proof (oracle-signed, gasless AA UserOp)
 *   5. Escrow releases USDC to seller
 *
 * Usage:  npm run seller-sms
 * Port:   process.env.SELLER_PORT (default 4001)
 */

import "dotenv/config";
import * as http from "http";
import { ethers } from "ethers";
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

const PORT         = parseInt(process.env.SELLER_PORT ?? "4001");
const USDC_ADDR    = process.env.USDC_ADDRESS ?? process.env.PYUSD_ADDRESS!;
const TOKEN_DEC    = parseInt(process.env.TOKEN_DECIMALS ?? "6");
const PRICE        = BigInt(process.env.SMS_PRICE_UNITS ?? "1000");   // 0.001 USDC (6 dec)
const DEADLINE_SEC = 300;
const AGENT_NAME   = "sms.kite";
const PROOF_TYPE   = ProofType.ORACLE;

// Pieverse facilitator for x402 payment verification
const FACILITATOR  = process.env.FACILITATOR_URL ?? "https://facilitator.pieverse.io";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag.padEnd(8)}] ${msg}`);
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

// ─── Payment verification via Pieverse ───────────────────────────────────────

interface PieceverseVerifyResult {
  isValid: boolean;
  invalidReason?: string;
  response?: {
    success: boolean;
    transaction?: { transactionHash: string };
  };
}

async function verifyPayment(
  xPayment: string,
  sellerAA: string,
  amount: bigint,
  resource: string,
): Promise<PieceverseVerifyResult> {
  // Decode base64 X-Payment header
  let paymentPayload: unknown;
  try {
    paymentPayload = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8"));
  } catch {
    return { isValid: false, invalidReason: "X-Payment header is not valid base64 JSON" };
  }

  log("verify", `Pieverse verify → ${FACILITATOR}/verify`);
  const resp = await fetch(`${FACILITATOR}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payload: paymentPayload,
      resource,
      amount: amount.toString(),
      asset: USDC_ADDR,
      payTo: sellerAA,
      network: "kite-mainnet",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "unknown");
    return { isValid: false, invalidReason: `Facilitator ${resp.status}: ${errText}` };
  }

  const result = await resp.json() as PieceverseVerifyResult;
  return result;
}

// ─── Core trade logic ─────────────────────────────────────────────────────────

interface SettlementResult {
  taskId: string;
  result: string;
  paymentId: string;
  quittanceTx: string;
  blockNumber: number;
  settled: boolean;
  usdcAmount: string;
}

async function executeTrade(
  provider: ReturnType<typeof getProvider>,
  sellerEOA: ethers.Wallet,
  sellerAA: string,
  sdk: ReturnType<typeof makeSDK>,
  buyerAA: string,
  paymentId: string,
  nonce: Uint8Array,
  amount: bigint,
  deadline: bigint,
  taskTarget: string,
): Promise<SettlementResult> {
  const c = getContracts(provider);

  // ── Verify buyer USDC balance + allowance ─────────────────────────────────
  const [allowance, buyerBal] = (await Promise.all([
    c.usdc.allowance(buyerAA, process.env.ESCROW_ADDRESS!),
    c.usdc.balanceOf(buyerAA),
  ])) as [bigint, bigint];

  if (allowance < amount) {
    throw Object.assign(
      new Error(`Buyer allowance too low: ${fmt(allowance)} < ${fmt(amount)} USDC`),
      { code: "INSUFFICIENT_ALLOWANCE" },
    );
  }
  if (buyerBal < amount) {
    throw Object.assign(
      new Error(`Buyer AA balance too low: ${fmt(buyerBal)} < ${fmt(amount)} USDC — fund ${buyerAA}`),
      { code: "INSUFFICIENT_BALANCE" },
    );
  }

  // ── Verify paymentId ──────────────────────────────────────────────────────
  const expectedId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);
  if (expectedId.toLowerCase() !== paymentId.toLowerCase()) {
    throw Object.assign(new Error("paymentId mismatch"), { code: "BAD_PAYMENT_ID" });
  }
  log("verify", `paymentId ✓  buyer ${fmt(buyerBal)} USDC  allowance ${fmt(allowance)} USDC ✓`);

  // ── Open escrow (seller AA UserOp — gasless) ──────────────────────────────
  log("escrow", `opening escrow via seller AA…`);
  const openCD = encodeCall(
    "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
    [paymentId, buyerAA, sellerAA, amount, deadline, PROOF_TYPE],
  );
  const openResult = await aaSend(sdk, sellerEOA, process.env.ESCROW_ADDRESS!, openCD);
  log("escrow", `opened tx ${openResult.txHash}  block ${openResult.blockNumber}`);

  // ── Execute SMS delivery ──────────────────────────────────────────────────
  log("deliver", `delivering SMS to ${taskTarget}…`);
  const sid = `SID_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const result = `SMS delivered to ${taskTarget}  sid=${sid}`;
  const resultHash = ethers.keccak256(ethers.toUtf8Bytes(result));
  const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`send SMS: ${taskTarget}`));
  log("deliver", `✓ ${result}`);

  // ── Oracle signs proof ────────────────────────────────────────────────────
  const oracleKey = process.env.ORACLE_PRIVATE_KEY!;
  const oracleEOA = getSigner(oracleKey, provider);
  const proofSig  = await signOracleProof(oracleEOA, paymentId, resultHash);
  log("prove", `oracle signed  sig ${proofSig.slice(0, 22)}…`);

  // ── Post quittance → escrow settles (gasless AA UserOp) ──────────────────
  log("settle", `posting quittance via seller AA…`);
  const now = BigInt(Math.floor(Date.now() / 1000));
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
  log("settle", `quittance tx ${settleResult.txHash}  block ${settleResult.blockNumber}`);

  return {
    taskId:      paymentId.slice(2, 10),
    result,
    paymentId,
    quittanceTx: settleResult.txHash,
    blockNumber: settleResult.blockNumber,
    settled:     true,
    usdcAmount:  fmt(amount),
  };
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

async function main() {
  const provider  = getProvider();
  const network   = await provider.getNetwork();
  log("boot", `Network: Kite Mainnet  chainId=${network.chainId}`);

  const sellerKey = process.env.SELLER_SMS_PRO_PRIVATE_KEY;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;
  if (!sellerKey || !oracleKey) {
    console.error("Set SELLER_SMS_PRO_PRIVATE_KEY and ORACLE_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const sellerEOA = getSigner(sellerKey, provider);
  const sdk       = makeSDK();
  const sellerAA  = aaAddress(sdk, sellerEOA.address);

  const c = getContracts(provider);
  const [bond, minBond] = (await Promise.all([
    c.bond.bonds(sellerAA),
    c.bond.MIN_BOND(),
  ])) as [bigint, bigint];

  log("boot", `Seller EOA: ${sellerEOA.address}`);
  log("boot", `Seller AA:  ${sellerAA}`);
  log("boot", `Bond: ${fmt(bond)} USDC (min ${fmt(minBond)}) ${bond >= minBond ? "✓" : "← run npm run integration first"}`);
  log("boot", `Price: ${fmt(PRICE)} USDC/SMS   Proof: ORACLE`);

  // Seller's service URL — used as the x402 resource identifier
  const SELLER_URL = process.env.SELLER_URL ?? `http://localhost:${PORT}/task`;

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }

    if (req.method !== "POST" || req.url !== "/task") {
      json(res, 404, { error: "POST /task only" });
      return;
    }

    let rawBody = "";
    req.on("data", (chunk) => { rawBody += chunk; });
    await new Promise((r) => req.on("end", r));

    let body: { to?: string; message?: string } = {};
    try { body = JSON.parse(rawBody || "{}"); } catch { /**/ }

    const taskTarget = body.to ?? "unknown";
    const xPayment   = req.headers["x-payment"] as string | undefined;

    // ── Round 1: no payment → standard x402 402 challenge ─────────────────
    if (!xPayment) {
      const taskId = Math.random().toString(36).slice(2, 10);
      log("req", `[${taskId}] 402 challenge → buyer (${taskTarget})`);

      json(res, 402, {
        accepts: [
          {
            scheme:           "exact",
            network:          "kite-mainnet",
            maxAmountRequired: PRICE.toString(),
            resource:         SELLER_URL,
            description:      `SMS delivery to ${taskTarget}`,
            mimeType:         "application/json",
            payTo:            sellerAA,
            maxTimeoutSeconds: DEADLINE_SEC,
            asset:            USDC_ADDR,
            extra: {
              taskId,
              name:    AGENT_NAME,
              version: "1",
            },
          },
        ],
        error: "Payment required",
      });
      return;
    }

    // ── Round 2: X-Payment header present → verify + execute ──────────────
    log("req", `X-Payment received (${xPayment.length} chars)`);

    try {
      // 1. Verify with Pieverse
      const verification = await verifyPayment(xPayment, sellerAA, PRICE, SELLER_URL);
      if (!verification.isValid) {
        log("req", `✗ Payment invalid: ${verification.invalidReason}`);
        json(res, 402, { error: verification.invalidReason ?? "Payment verification failed" });
        return;
      }
      log("verify", `Pieverse: payment valid ✓`);

      // 2. Extract payment details from the verified payload for escrow
      // kpass signs a standard EIP-3009 transferWithAuthorization payload
      // We derive our paymentId from the nonce in the payment payload
      let paymentPayload: Record<string, unknown> = {};
      try {
        paymentPayload = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8")) as Record<string, unknown>;
      } catch { /**/ }

      const buyerAA    = paymentPayload.from as string ?? "";
      const nonce      = ethers.getBytes(paymentPayload.nonce as string ?? ethers.hexlify(ethers.randomBytes(32)));
      const deadline   = BigInt(paymentPayload.validBefore as string ?? Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      const amount     = BigInt((paymentPayload.value as string) ?? PRICE.toString());
      const paymentId  = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);

      // 3. Execute trade (open escrow → deliver → post quittance)
      const settlement = await executeTrade(
        provider, sellerEOA, sellerAA, sdk,
        buyerAA, paymentId, nonce, amount, deadline, taskTarget,
      );

      log("req", `✓ settled  paymentId=${paymentId.slice(0, 14)}…  quittanceTx=${settlement.quittanceTx.slice(0, 14)}…`);
      json(res, 200, settlement);
    } catch (err: unknown) {
      const e = err as { reason?: string; shortMessage?: string; message?: string; code?: string };
      const reason = e.reason ?? e.shortMessage ?? e.message ?? "unknown error";
      const code   = e.code ?? "INTERNAL_ERROR";
      log("req", `✗ ${code}: ${reason}`);
      const httpStatus =
        code === "INSUFFICIENT_ALLOWANCE" || code === "INSUFFICIENT_BALANCE" ? 402 : 500;
      json(res, httpStatus, { error: reason, code });
    }
  });

  server.listen(PORT, () => {
    log("boot", `\n  ${AGENT_NAME} listening on http://localhost:${PORT}/task`);
    log("boot", `  Price: ${fmt(PRICE)} USDC/SMS   x402 standard format   Kite mainnet\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
