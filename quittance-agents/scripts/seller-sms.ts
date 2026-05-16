/**
 * seller-sms.ts — Quittance SMS Seller Agent (x402 + AA)
 *
 * Runs an HTTP server that sells SMS delivery as an x402 service.
 * Every payment is settled on-chain via a Kite AA passport (gasless).
 *
 * x402 protocol:
 *   POST /task                     → 402 { challenge }
 *   POST /task + X-Payment-* hdrs  → 200 { result, quittance }
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
import { makeSDK, aaAddress, aaSend, aaBatch, encodeCall } from "../lib/aa";
import { parsePaymentHeaders } from "../lib/x402";
import type { X402Challenge, X402Settlement } from "../lib/x402";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT         = parseInt(process.env.SELLER_PORT ?? "4001");
const PRICE        = ethers.parseUnits("0.001", 18);   // 0.001 PYUSD per SMS
const DEADLINE_SEC = 300;                               // 5 min delivery window
const AGENT_NAME   = "sms.kite";
const PROOF_TYPE   = ProofType.ORACLE;

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
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

// ─── Seller state ─────────────────────────────────────────────────────────────

interface PendingTask {
  taskId: string;
  createdAt: number;
  body: string;
}

const pendingTasks = new Map<string, PendingTask>();

// ─── Core trade logic ─────────────────────────────────────────────────────────

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
  taskBody: string,
): Promise<X402Settlement> {
  const c = getContracts(provider);

  // ── Verify buyer allowance ─────────────────────────────────────────────────
  const allowance = (await c.pyusd.allowance(buyerAA, process.env.ESCROW_ADDRESS!)) as bigint;
  if (allowance < amount) {
    throw Object.assign(
      new Error(`Buyer allowance too low: ${fmt(allowance)} < ${fmt(amount)}`),
      { code: "INSUFFICIENT_ALLOWANCE" },
    );
  }

  // ── Verify paymentId matches ───────────────────────────────────────────────
  const expectedId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);
  if (expectedId.toLowerCase() !== paymentId.toLowerCase()) {
    throw Object.assign(new Error("paymentId mismatch"), { code: "BAD_PAYMENT_ID" });
  }
  log("verify", `paymentId ✓  buyer allowance ${fmt(allowance)} PYUSD ✓`);

  // ── Open escrow (seller AA UserOp) ─────────────────────────────────────────
  log("escrow", `opening escrow via seller AA…`);
  const openCD = encodeCall(
    "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
    [paymentId, buyerAA, sellerAA, amount, deadline, PROOF_TYPE],
  );
  const openResult = await aaSend(sdk, sellerEOA, process.env.ESCROW_ADDRESS!, openCD);
  log("escrow", `opened tx ${openResult.txHash}  block ${openResult.blockNumber}`);

  // ── Execute task (mock SMS delivery) ──────────────────────────────────────
  log("deliver", `executing SMS to ${taskBody}…`);
  const sid = `SID_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const result = `SMS delivered to ${taskBody}  sid=${sid}`;
  const resultHash = ethers.keccak256(ethers.toUtf8Bytes(result));
  const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`send SMS: ${taskBody}`));
  log("deliver", `✓ ${result}`);

  // ── Oracle signs proof ────────────────────────────────────────────────────
  const oracleKey = process.env.ORACLE_PRIVATE_KEY!;
  const oracleEOA = getSigner(oracleKey, provider);
  const proofSig  = await signOracleProof(oracleEOA, paymentId, resultHash);
  log("prove", `oracle signed  sig ${proofSig.slice(0, 22)}…`);

  // ── Post quittance → escrow settles (seller AA UserOp) ────────────────────
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
  };
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

async function main() {
  const provider  = getProvider();
  const network   = await provider.getNetwork();
  log("boot", `Network: Kite Testnet  chainId=${network.chainId}`);

  const sellerKey = process.env.SELLER_SMS_PRO_PRIVATE_KEY;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;
  if (!sellerKey || !oracleKey) {
    console.error("Set SELLER_SMS_PRO_PRIVATE_KEY and ORACLE_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const sellerEOA = getSigner(sellerKey, provider);
  const sdk       = makeSDK();
  const sellerAA  = aaAddress(sdk, sellerEOA.address);

  // Verify bonded
  const c = getContracts(provider);
  const [bond, minBond] = (await Promise.all([
    c.bond.bonds(sellerAA),
    c.bond.MIN_BOND(),
  ])) as [bigint, bigint];

  log("boot", `Seller EOA: ${sellerEOA.address}`);
  log("boot", `Seller AA:  ${sellerAA}`);
  log("boot", `Bond: ${fmt(bond)} PYUSD (min ${fmt(minBond)}) ${bond >= minBond ? "✓" : "← run npm run integration first"}`);

  const server = http.createServer(async (req, res) => {
    // CORS pre-flight
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }

    if (req.method !== "POST" || req.url !== "/task") {
      json(res, 404, { error: "POST /task only" });
      return;
    }

    // Parse body
    let rawBody = "";
    req.on("data", (chunk) => { rawBody += chunk; });
    await new Promise((r) => req.on("end", r));

    let body: { to?: string; message?: string } = {};
    try { body = JSON.parse(rawBody || "{}"); } catch { /**/ }

    const taskTarget = body.to ?? "unknown";
    const payment    = parsePaymentHeaders(req.headers as Record<string, string>);

    // ── Round 1: no payment → 402 challenge ───────────────────────────────────
    if (!payment) {
      const taskId = Math.random().toString(36).slice(2, 10);
      pendingTasks.set(taskId, { taskId, createdAt: Date.now(), body: taskTarget });

      log("req", `[${taskId}] 402 challenge → buyer (${taskTarget})`);
      const challenge: X402Challenge = {
        required:       true,
        amount:         PRICE.toString(),
        token:          process.env.PYUSD_ADDRESS!,
        sellerPassport: sellerAA,
        deadlineOffset: DEADLINE_SEC,
        taskId,
      };
      json(res, 402, challenge);
      return;
    }

    // ── Round 2: payment headers present → process ───────────────────────────
    const { "X-Payment-Id": paymentId, "X-Payment-Nonce": nonceHex,
            "X-Payment-Buyer": buyerAA,  "X-Payment-Amount": amountStr,
            "X-Payment-Deadline": deadlineStr } = payment;

    log("req", `payment auth received  paymentId=${paymentId.slice(0, 14)}…`);

    try {
      const nonce    = ethers.getBytes(nonceHex);
      const amount   = BigInt(amountStr);
      const deadline = BigInt(deadlineStr);

      const settlement = await executeTrade(
        provider, sellerEOA, sellerAA, sdk,
        buyerAA, paymentId, nonce, amount, deadline, taskTarget,
      );

      log("req", `✓ settled  taskId=${settlement.taskId}`);
      json(res, 200, settlement);
    } catch (err: any) {
      log("req", `✗ error: ${err.message}`);
      json(res, err.code === "INSUFFICIENT_ALLOWANCE" ? 402 : 500, {
        error: err.message,
        code: err.code ?? "INTERNAL_ERROR",
      });
    }
  });

  server.listen(PORT, () => {
    log("boot", `\n  ${AGENT_NAME} listening on http://localhost:${PORT}/task`);
    log("boot", `  Price: ${fmt(PRICE)} PYUSD/SMS   Proof: ORACLE   Passport: ${sellerAA}`);
    log("boot", `  Ready for buyer requests\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
