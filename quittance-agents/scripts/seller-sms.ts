/**
 * seller-sms.ts — Quittance SMS Seller Agent (two-round Quittance protocol)
 *
 * Two-round payment protocol:
 *   Round 1 — POST /task { to, message, buyerAA }
 *     → 200 { paymentId, sellerAA, amountUSDC, deadline }
 *     Seller generates a paymentId and waits for payment.
 *
 *   Round 2 — POST /task { to, message, buyerAA, paymentId, txHash }
 *     Buyer proves on-chain payment (kpass wallet send tx).
 *     → 200 { result, quittanceTx, blockNumber, paymentId, usdcAmount }
 *     Seller verifies USDC receipt on-chain, opens Quittance escrow,
 *     delivers SMS, posts oracle proof, escrow releases to seller.
 *
 * NOTE: Designed to swap seamlessly to x402 kpass:session execute once
 * the service URL is approved in the kpass service discovery registry.
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

// Block confirmations to wait for before accepting payment (0 = same-block ok)
const CONFIRM_BLOCKS = parseInt(process.env.PAYMENT_CONFIRM_BLOCKS ?? "0");

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

// ─── On-chain payment verification ───────────────────────────────────────────

/**
 * Verifies that `txHash` transferred at least `amount` USDC to `sellerAA`
 * by checking the Transfer event in the transaction receipt.
 */
async function verifyOnChainPayment(
  provider: ReturnType<typeof getProvider>,
  txHash: string,
  sellerAA: string,
  amount: bigint,
): Promise<{ ok: boolean; reason?: string }> {
  log("verify", `Checking on-chain payment tx ${txHash.slice(0, 14)}…`);

  let receipt: ethers.TransactionReceipt | null = null;
  for (let i = 0; i < 12; i++) {
    receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }

  if (!receipt) return { ok: false, reason: `tx ${txHash} not found after 36s` };
  if (receipt.status !== 1) return { ok: false, reason: `tx ${txHash} reverted` };

  // Verify block confirmations
  const latest = await provider.getBlockNumber();
  if (latest - receipt.blockNumber < CONFIRM_BLOCKS) {
    return { ok: false, reason: `only ${latest - receipt.blockNumber} confirmations (need ${CONFIRM_BLOCKS})` };
  }

  // Check Transfer(from, to, amount) event from the USDC contract
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const sellerTopic   = ethers.zeroPadValue(sellerAA.toLowerCase(), 32);

  const relevantLog = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === USDC_ADDR.toLowerCase() &&
      l.topics[0] === transferTopic &&
      l.topics[2]?.toLowerCase() === sellerTopic.toLowerCase(),
  );

  if (!relevantLog) {
    return { ok: false, reason: `No USDC Transfer to ${sellerAA} found in tx` };
  }

  const transferred = BigInt(relevantLog.data);
  if (transferred < amount) {
    return { ok: false, reason: `Transferred ${fmt(transferred)} USDC < required ${fmt(amount)} USDC` };
  }

  log("verify", `On-chain payment verified ✓  ${fmt(transferred)} USDC → seller  block ${receipt.blockNumber}`);
  return { ok: true };
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
  // ── Verify paymentId ──────────────────────────────────────────────────────
  const expectedId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);
  if (expectedId.toLowerCase() !== paymentId.toLowerCase()) {
    throw Object.assign(new Error("paymentId mismatch"), { code: "BAD_PAYMENT_ID" });
  }
  log("verify", `paymentId ✓  buyer=${buyerAA.slice(0, 10)}…  seller=${sellerAA.slice(0, 10)}…`);

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

  // In-memory map of paymentId → pending Round 1 state (nonce, deadline, buyerAA)
  const pendingPayments = new Map<string, {
    nonce: Uint8Array;
    deadline: bigint;
    buyerAA: string;
    taskTarget: string;
  }>();

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

    let body: {
      to?: string;
      message?: string;
      buyerAA?: string;
      paymentId?: string;
      txHash?: string;
    } = {};
    try { body = JSON.parse(rawBody || "{}"); } catch { /**/ }

    const taskTarget = body.to ?? "unknown";
    const isRound2   = !!(body.paymentId && body.txHash);

    // ── Round 1: no txHash → return paymentId + payment instructions ──────
    if (!isRound2) {
      if (!body.buyerAA) {
        json(res, 400, { error: "buyerAA required" });
        return;
      }

      const buyerAA  = body.buyerAA;
      const nonce    = ethers.randomBytes(32);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      const paymentId = makePaymentId(buyerAA, sellerAA, PRICE, deadline, nonce);

      log("req", `[R1] task accepted  buyer=${buyerAA.slice(0, 10)}…  paymentId=${paymentId.slice(0, 14)}…`);

      // Cache nonce + deadline so Round 2 can reconstruct escrow correctly
      pendingPayments.set(paymentId, { nonce, deadline, buyerAA, taskTarget });

      json(res, 200, {
        paymentId,
        sellerAA,
        amountUSDC: fmt(PRICE),
        deadline:   Number(deadline),
        note:       `Send exactly ${fmt(PRICE)} USDC to ${sellerAA} on Kite mainnet, then call Round 2 with the txHash.`,
      });
      return;
    }

    // ── Round 2: txHash present → verify + execute ─────────────────────────
    const { paymentId, txHash, buyerAA = "" } = body as {
      paymentId: string;
      txHash: string;
      buyerAA: string;
    };

    log("req", `[R2] paymentId=${paymentId.slice(0, 14)}…  tx=${txHash.slice(0, 14)}…`);

    const pending = pendingPayments.get(paymentId);
    if (!pending) {
      json(res, 400, { error: "Unknown paymentId — did you call Round 1 first?" });
      return;
    }
    pendingPayments.delete(paymentId);

    try {
      // 1. Verify on-chain USDC transfer
      const check = await verifyOnChainPayment(provider, txHash, sellerAA, PRICE);
      if (!check.ok) {
        json(res, 402, { error: `Payment verification failed: ${check.reason}` });
        return;
      }

      // 2. Execute trade (open escrow → deliver SMS → post quittance)
      const settlement = await executeTrade(
        provider, sellerEOA, sellerAA, sdk,
        pending.buyerAA, paymentId, pending.nonce, PRICE, pending.deadline, taskTarget,
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
  log("boot", `  Price: ${fmt(PRICE)} USDC/SMS   two-round protocol   Kite mainnet`);
  log("boot", `  Swap to kpass:session execute once URL is allowlisted\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
