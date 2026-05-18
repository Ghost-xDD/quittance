import * as http from "http";
import { ethers } from "ethers";
import { makePaymentId } from "./contracts.js";
import { makeSettlement, CheapModeSkipError } from "./settlement.js";
import { getSigner } from "./contracts.js";
import { getProvider } from "./contracts.js";
import type { QuittanceServerConfig } from "./types.js";

function jsonRes(
  res:          http.ServerResponse,
  status:       number,
  body:         unknown,
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
  try { return JSON.parse(Buffer.from(header, "base64").toString("utf8")); }
  catch { return null; }
}

function b64(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function log(agentName: string, tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${agentName}] [${tag.padEnd(8)}] ${msg}`);
}

export function createSellerServer<TPayload = Record<string, unknown>>(
  cfg: QuittanceServerConfig<TPayload>,
): http.Server {
  const price    = BigInt(cfg.price);
  const deadline = cfg.cheapMode
    ? (cfg.cheapDeadlineSeconds ?? 60)
    : (cfg.deadlineSeconds ?? 300);
  const cheapFailRate  = cfg.cheapFailRate ?? 0.8;
  const minBondTier    = cfg.minBondTier ?? "bronze";
  const parseBody      = cfg.parseBody ?? ((raw) => raw as unknown as TPayload);
  const settlement     = makeSettlement(cfg.settlement ?? "onchain");
  const sellerAA       = settlement.getSellerAA();

  // paymentId → pending Round 1 state
  type Pending = {
    nonce:       Uint8Array;
    deadline:    bigint;
    buyerAA:     string;
    payload:     TPayload;
    requestHash: string;
  };
  const pending = new Map<string, Pending>();

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      jsonRes(res, 200, { ok: true, seller: cfg.agentName, sellerAA });
      return;
    }

    if (req.method !== "POST" || req.url !== "/task") {
      jsonRes(res, 404, { error: "POST /task only" });
      return;
    }

    let raw = "";
    req.on("data", (c) => { raw += c; });
    await new Promise((r) => req.on("end", r));

    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || "{}"); } catch { /**/ }

    const xPaymentHeader = req.headers["x-payment"] as string | undefined;

    // ── Round 1: no X-PAYMENT → issue 402 ────────────────────────────────────
    if (!xPaymentHeader) {
      const { buyerAA } = body;
      if (!buyerAA || typeof buyerAA !== "string") {
        jsonRes(res, 400, { error: "buyerAA is required" });
        return;
      }

      const payload     = parseBody(body);
      const nonce       = ethers.randomBytes(32);
      const dl          = BigInt(Math.floor(Date.now() / 1000) + deadline);
      const paymentId   = makePaymentId(buyerAA, sellerAA, price, dl, nonce);
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));

      pending.set(paymentId, { nonce, deadline: dl, buyerAA, payload, requestHash });
      log(cfg.agentName, "req", `[R1] 402  buyer=${buyerAA.slice(0, 10)}…  pid=${paymentId.slice(0, 14)}…`);

      const provider = getProvider();
      jsonRes(res, 402, {
        accepts: [{
          scheme:            "gokite-aa",
          network:           "kite-mainnet",
          maxAmountRequired: price.toString(),
          payTo:             process.env.ESCROW_ADDRESS!,
          asset:             process.env.USDC_ADDRESS ?? process.env.PYUSD_ADDRESS,
          extra: {
            quittance: {
              version:         "Q001",
              escrow:          process.env.ESCROW_ADDRESS!,
              registry:        process.env.REGISTRY_ADDRESS!,
              proofType:       "ORACLE",
              deadlineSeconds: deadline,
              minBondTier,
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

    // ── Round 2: X-PAYMENT present → verify + settle ─────────────────────────
    const xp = parseXPayment(xPaymentHeader);
    if (!xp) {
      jsonRes(res, 400, { error: "Invalid X-PAYMENT: not valid base64 JSON" });
      return;
    }

    const { paymentId, buyerAA } = xp as { paymentId: string; buyerAA: string };
    if (!paymentId || !buyerAA) {
      jsonRes(res, 400, { error: "X-PAYMENT must contain paymentId and buyerAA" });
      return;
    }

    const p = pending.get(paymentId);
    if (!p) {
      jsonRes(res, 400, { error: "Unknown paymentId — call without X-PAYMENT first" });
      return;
    }
    if (p.buyerAA.toLowerCase() !== buyerAA.toLowerCase()) {
      jsonRes(res, 400, { error: "buyerAA mismatch" });
      return;
    }

    const allowanceCheck = await settlement.checkAllowance(buyerAA, price);
    if (!allowanceCheck.ok) {
      jsonRes(res, 402, { error: allowanceCheck.reason });
      return;
    }

    pending.delete(paymentId);
    log(cfg.agentName, "req", `[R2] X-PAYMENT  pid=${paymentId.slice(0, 14)}…  buyer=${buyerAA.slice(0, 10)}…`);

    try {
      const result = await settlement.settle({
        buyerAA, paymentId,
        nonce:       p.nonce,
        amount:      price,
        deadline:    p.deadline,
        requestHash: p.requestHash,
        payload:     p.payload,
        deliver:     cfg.deliver,
        cheapMode:   cfg.cheapMode ?? false,
        cheapFailRate,
      });

      log(cfg.agentName, "settle", `✓ quittanceTx=${result.quittanceTx.slice(0, 14)}…`);
      jsonRes(res, 200, result, {
        "X-PAYMENT-RESPONSE": b64({
          scheme: "gokite-aa", network: "kite-mainnet", paymentId,
          escrowTx: result.escrowTx, quittanceTx: result.quittanceTx,
          deliveredAt: Math.floor(Date.now() / 1000),
        }),
      });
    } catch (err: unknown) {
      if (err instanceof CheapModeSkipError) {
        log(cfg.agentName, "cheap", `escrow open, skipping delivery  tx=${err.escrowTx}`);
        jsonRes(res, 202, {
          paymentId,
          escrowTx: err.escrowTx,
          deadline: Number(err.deadline),
          status:   "accepted_not_delivered",
          note:     "Cheap seller accepted payment. Refund fires at deadline.",
        });
        return;
      }
      const e = err as { reason?: string; shortMessage?: string; message?: string; code?: string };
      const reason = e.reason ?? e.shortMessage ?? e.message ?? "unknown";
      const code   = e.code   ?? "INTERNAL_ERROR";
      log(cfg.agentName, "error", `${code}: ${reason}`);
      jsonRes(res, code === "BAD_PAYMENT_ID" ? 400 : 500, { error: reason, code });
    }
  });

  return server;
}
