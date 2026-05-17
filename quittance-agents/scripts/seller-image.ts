/**
 * seller-image.ts — Quittance Image Seller Agent (facilitator-free x402)
 *
 * Same spec-compliant x402 flow as seller-email.ts.
 * Service: generates a real image via Pollinations.ai (free, no API key required).
 * Proof:   ORACLE on keccak256(imageUrl) — attestor signs that this URL was fetched.
 *
 * Upgrade path: swap Pollinations.ai for fal.ai (which itself speaks x402).
 *
 * Usage:  npm run seller-image   (port 4004)
 */

import "dotenv/config";
import * as http from "http";
import * as https from "https";
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

// Railway injects PORT; SELLER_IMAGE_PORT is the local-dev fallback.
const PORT         = parseInt(process.env.PORT ?? process.env.SELLER_IMAGE_PORT ?? "4004");
const USDC_ADDR    = process.env.USDC_ADDRESS ?? process.env.PYUSD_ADDRESS!;
const PRICE        = BigInt(process.env.IMAGE_PRICE_UNITS ?? "1000"); // 0.001 USDC
const DEADLINE_SEC = 300;
const AGENT_NAME   = "image.kite";
const PROOF_TYPE   = ProofType.ORACLE;

// Pollinations.ai: free, no key, direct HTTP image generation
const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";
const IMAGE_WIDTH  = parseInt(process.env.IMAGE_WIDTH  ?? "512");
const IMAGE_HEIGHT = parseInt(process.env.IMAGE_HEIGHT ?? "512");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag.padEnd(8)}] ${msg}`);
}

function jsonRes(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Length":               Buffer.byteLength(data),
    ...extraHeaders,
  });
  res.end(data);
}

function parseXPayment(header: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function encodeXPaymentResponse(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

/** Follow redirects and return the final resolved URL (Pollinations redirects to CDN). */
async function resolveImageUrl(prompt: string): Promise<string> {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `${POLLINATIONS_URL}/${encodedPrompt}?width=${IMAGE_WIDTH}&height=${IMAGE_HEIGHT}&nologo=true`;

  return new Promise((resolve, reject) => {
    const follow = (currentUrl: string, redirects = 0) => {
      if (redirects > 5) { reject(new Error("Too many redirects from Pollinations")); return; }
      https.get(currentUrl, (r) => {
        if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          follow(r.headers.location, redirects + 1);
        } else if (r.statusCode === 200) {
          r.resume();
          resolve(currentUrl);
        } else {
          r.resume();
          reject(new Error(`Pollinations returned HTTP ${r.statusCode}`));
        }
      }).on("error", reject);
    };
    follow(url);
  });
}

async function checkAllowance(
  provider:   ReturnType<typeof getProvider>,
  buyerAA:    string,
  escrowAddr: string,
  required:   bigint,
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
  taskId:      string;
  imageUrl:    string;
  paymentId:   string;
  escrowTx:    string;
  quittanceTx: string;
  blockNumber: number;
  settled:     boolean;
  usdcAmount:  string;
}

async function executeTrade(
  provider:    ReturnType<typeof getProvider>,
  sellerEOA:   ethers.Wallet,
  sellerAA:    string,
  sdk:         ReturnType<typeof makeSDK>,
  buyerAA:     string,
  paymentId:   string,
  nonce:       Uint8Array,
  amount:      bigint,
  deadline:    bigint,
  prompt:      string,
  requestHash: string,
): Promise<SettlementResult> {
  // ── 1. Verify paymentId ────────────────────────────────────────────────────
  const expectedId = makePaymentId(buyerAA, sellerAA, amount, deadline, nonce);
  if (expectedId.toLowerCase() !== paymentId.toLowerCase()) {
    throw Object.assign(new Error("paymentId mismatch"), { code: "BAD_PAYMENT_ID" });
  }
  log("verify", `paymentId ✓  buyer=${buyerAA.slice(0, 10)}…  seller=${sellerAA.slice(0, 10)}…`);

  // ── 2. Open escrow ─────────────────────────────────────────────────────────
  log("escrow", `opening escrow…  amount=${fmt(amount)} USDC`);
  const escrowAddr = process.env.ESCROW_ADDRESS!;
  const openCD = encodeCall(
    "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
    [paymentId, buyerAA, sellerAA, amount, deadline, PROOF_TYPE],
  );
  const escrowResult = await aaSend(sdk, sellerEOA, escrowAddr, openCD);
  log("escrow", `EscrowOpened  tx=${escrowResult.txHash}  block=${escrowResult.blockNumber}`);

  // ── 3. Generate image via Pollinations.ai ──────────────────────────────────
  log("deliver", `generating image for prompt: "${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}"`);
  const imageUrl = await resolveImageUrl(prompt);
  log("deliver", `✓ imageUrl=${imageUrl.slice(0, 80)}…`);

  // Result = image URL; proof = keccak256(imageUrl)
  const result     = imageUrl;
  const resultHash = ethers.keccak256(ethers.toUtf8Bytes(imageUrl));

  // ── 4. Oracle signs proof of image URL ────────────────────────────────────
  const oracleKey = process.env.ORACLE_PRIVATE_KEY!;
  const oracleEOA = getSigner(oracleKey, provider);
  const proofSig  = await signOracleProof(oracleEOA, paymentId, resultHash);
  log("prove", `oracle signed keccak256(imageUrl)  sig=${proofSig.slice(0, 22)}…`);

  // ── 5. Post quittance → escrow auto-releases ───────────────────────────────
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
    imageUrl,
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
  const sellerKey = process.env.SELLER_IMAGE_PRIVATE_KEY ?? process.env.SELLER_EMAIL_PRIVATE_KEY ?? process.env.SELLER_SMS_PRO_PRIVATE_KEY;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;
  if (!sellerKey || !oracleKey) {
    console.error("Set SELLER_IMAGE_PRIVATE_KEY and ORACLE_PRIVATE_KEY in .env");
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

  log("boot", `Agent:      ${AGENT_NAME}`);
  log("boot", `Seller EOA: ${sellerEOA.address}`);
  log("boot", `Seller AA:  ${sellerAA}`);
  log("boot", `Bond: ${fmt(bond)} USDC (min ${fmt(minBond)}) ${bond >= minBond ? "✓" : "← run npm run setup-mainnet first"}`);
  log("boot", `Price: ${fmt(PRICE)} USDC/image   Image: ${IMAGE_WIDTH}×${IMAGE_HEIGHT}  Provider: Pollinations.ai`);

  const pending = new Map<string, {
    nonce:       Uint8Array;
    deadline:    bigint;
    buyerAA:     string;
    prompt:      string;
    requestHash: string;
  }>();

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      jsonRes(res, 200, { ok: true, seller: AGENT_NAME });
      return;
    }

    if (req.method !== "POST" || req.url !== "/task") {
      jsonRes(res, 404, { error: "POST /task only" });
      return;
    }

    let rawBody = "";
    req.on("data", (chunk) => { rawBody += chunk; });
    await new Promise((r) => req.on("end", r));

    let reqBody: { prompt?: string; buyerAA?: string } = {};
    try { reqBody = JSON.parse(rawBody || "{}"); } catch { /**/ }

    const xPaymentHeader = req.headers["x-payment"] as string | undefined;

    // ── Round 1: no X-PAYMENT → 402 ─────────────────────────────────────────
    if (!xPaymentHeader) {
      const { prompt, buyerAA } = reqBody;
      if (!prompt || !buyerAA) {
        jsonRes(res, 400, { error: "prompt and buyerAA are required" });
        return;
      }

      const nonce       = ethers.randomBytes(32);
      const deadline    = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      const paymentId   = makePaymentId(buyerAA, sellerAA, PRICE, deadline, nonce);
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ prompt })));

      pending.set(paymentId, { nonce, deadline, buyerAA, prompt, requestHash });
      log("req", `[R1] 402 issued  buyer=${buyerAA.slice(0, 10)}…  prompt="${prompt.slice(0, 40)}…"`);

      jsonRes(res, 402, {
        accepts: [{
          scheme:            "gokite-aa",
          network:           "kite-mainnet",
          maxAmountRequired: PRICE.toString(),
          payTo:             process.env.ESCROW_ADDRESS!,
          asset:             USDC_ADDR,
          extra: {
            quittance: {
              version:         "Q001",
              escrow:          process.env.ESCROW_ADDRESS!,
              registry:        process.env.REGISTRY_ADDRESS!,
              proofType:       "ORACLE",
              deadlineSeconds: DEADLINE_SEC,
              minBondTier:     "bronze",
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

    // ── Round 2: X-PAYMENT present → verify + execute ────────────────────────
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
    // sessionToken is optional metadata. Full JWT verification is v0.1.

    const p = pending.get(paymentId);
    if (!p) {
      jsonRes(res, 400, { error: "Unknown paymentId — call without X-PAYMENT first" });
      return;
    }
    if (p.buyerAA.toLowerCase() !== buyerAA.toLowerCase()) {
      jsonRes(res, 400, { error: "buyerAA mismatch" });
      return;
    }

    const allowanceCheck = await checkAllowance(provider, buyerAA, process.env.ESCROW_ADDRESS!, PRICE);
    if (!allowanceCheck.ok) {
      jsonRes(res, 402, { error: allowanceCheck.reason });
      return;
    }

    pending.delete(paymentId);
    log("req", `[R2] X-PAYMENT verified  paymentId=${paymentId.slice(0, 14)}…`);

    try {
      const settlement = await executeTrade(
        provider, sellerEOA, sellerAA, sdk,
        buyerAA, paymentId, p.nonce, PRICE, p.deadline,
        p.prompt, p.requestHash,
      );

      const xPaymentResponse = encodeXPaymentResponse({
        scheme:      "gokite-aa",
        network:     "kite-mainnet",
        paymentId,
        escrowTx:    settlement.escrowTx,
        quittanceTx: settlement.quittanceTx,
        deliveredAt: Math.floor(Date.now() / 1000),
      });

      log("req", `✓ settled  imageUrl=${settlement.imageUrl.slice(0, 60)}…  quittanceTx=${settlement.quittanceTx.slice(0, 14)}…`);
      jsonRes(res, 200, settlement, { "X-PAYMENT-RESPONSE": xPaymentResponse });
    } catch (err: unknown) {
      const e = err as { reason?: string; shortMessage?: string; message?: string; code?: string };
      const reason = e.reason ?? e.shortMessage ?? e.message ?? "unknown error";
      const code   = e.code ?? "INTERNAL_ERROR";
      log("req", `✗ ${code}: ${reason}`);
      const httpStatus = code === "BAD_PAYMENT_ID" ? 400 : 500;
      jsonRes(res, httpStatus, { error: reason, code });
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    log("boot", `\n  ${AGENT_NAME} listening on http://0.0.0.0:${PORT}/task`);
    log("boot", `  Protocol: x402  scheme=gokite-aa  facilitator=none`);
    log("boot", `  Price: ${fmt(PRICE)} USDC/image  Provider: Pollinations.ai (free)\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
