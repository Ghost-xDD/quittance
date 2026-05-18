import { ethers } from "ethers";
import { GokiteAASDK } from "gokite-aa-sdk";
import { makeSDK, aaAddress, aaSend, encodeCall } from "./aa.js";
import {
  getProvider, getSigner, getContracts,
  makePaymentId, signOracleProof, fmt,
} from "./contracts.js";
import { ProofType } from "./abis.js";
import type { SettleResult, DeliverFn, SettlementMode, FacilitatorConfig } from "./types.js";

// ─── Internal class ────────────────────────────────────────────────────────────

interface SettleParams<TPayload> {
  buyerAA:     string;
  paymentId:   string;
  nonce:       Uint8Array;
  amount:      bigint;
  deadline:    bigint;
  requestHash: string;
  payload:     TPayload;
  deliver:     DeliverFn<TPayload>;
  cheapMode:   boolean;
  cheapFailRate: number;
}

export class CheapModeSkipError extends Error {
  readonly code     = "CHEAP_MODE_SKIP";
  readonly escrowTx: string;
  readonly deadline: bigint;
  constructor(escrowTx: string, deadline: bigint) {
    super("Delivery skipped (cheap mode)");
    this.escrowTx = escrowTx;
    this.deadline = deadline;
  }
}

// ─── On-chain settlement (v0 — facilitator-free) ──────────────────────────────
//
// Settlement path: seller calls openEscrow + Registry.post() directly.
// No Pieverse dependency. Works regardless of facilitator status.
//
// Upgrade path: when Pieverse is back up, pass settlement: { type: "facilitator", url }
// to switch to FacilitatorSettlement. On-chain artefacts are identical; the buyer
// never needs updating.

class OnChainSettlement {
  private provider:  ReturnType<typeof getProvider>;
  private sellerEOA: ethers.Wallet;
  private sellerAA:  string;
  private sdk:       GokiteAASDK;

  constructor() {
    this.provider  = getProvider();
    const key = process.env.SELLER_EMAIL_PRIVATE_KEY
      ?? process.env.SELLER_IMAGE_PRIVATE_KEY
      ?? process.env.SELLER_SMS_PRO_PRIVATE_KEY!;
    this.sellerEOA = getSigner(key, this.provider);
    this.sdk       = makeSDK();
    this.sellerAA  = aaAddress(this.sdk, this.sellerEOA.address);
  }

  getSellerAA(): string { return this.sellerAA; }
  getProvider(): ReturnType<typeof getProvider> { return this.provider; }

  async checkAllowance(buyerAA: string, required: bigint): Promise<{ ok: boolean; reason?: string }> {
    const erc20    = getContracts(this.provider).usdc;
    const escrow   = process.env.ESCROW_ADDRESS!;
    const allowance = await erc20.allowance(buyerAA, escrow) as bigint;
    return allowance >= required
      ? { ok: true }
      : { ok: false, reason: `Buyer AA allowance ${fmt(allowance)} USDC < required ${fmt(required)} USDC` };
  }

  async settle<TPayload>(p: SettleParams<TPayload>): Promise<SettleResult> {
    const expectedId = makePaymentId(p.buyerAA, this.sellerAA, p.amount, p.deadline, p.nonce);
    if (expectedId.toLowerCase() !== p.paymentId.toLowerCase()) {
      throw Object.assign(new Error("paymentId mismatch"), { code: "BAD_PAYMENT_ID" });
    }

    // 1. Open escrow — pulls from buyer AA's standing allowance
    const openCD = encodeCall(
      "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
      [p.paymentId, p.buyerAA, this.sellerAA, p.amount, p.deadline, ProofType.ORACLE],
    );
    const escrowResult = await aaSend(this.sdk, this.sellerEOA, process.env.ESCROW_ADDRESS!, openCD);

    // 2. Cheap mode: intentionally skip delivery, let the escrow expire for the slash demo
    if (p.cheapMode && Math.random() < p.cheapFailRate) {
      throw new CheapModeSkipError(escrowResult.txHash, p.deadline);
    }

    // 3. Deliver the service
    const deliveryResult = await p.deliver(p.payload, {
      paymentId: p.paymentId, buyerAA: p.buyerAA, sellerAA: this.sellerAA, amount: p.amount,
    });

    // 4. Oracle signs proof(paymentId, resultHash)
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes(deliveryResult));
    const oracleEOA  = getSigner(process.env.ORACLE_PRIVATE_KEY!, this.provider);
    const proofSig   = await signOracleProof(oracleEOA, p.paymentId, resultHash);

    // 5. Post quittance → escrow auto-releases
    const now    = BigInt(Math.floor(Date.now() / 1000));
    const postCD = encodeCall(
      `function post(tuple(
        bytes32 paymentId, bytes32 requestHash, bytes32 resultHash,
        address sellerPassport, address buyerPassport,
        uint8 proofType, bytes proofPayload, address attestor,
        uint64 deliveredAt, uint64 deadline
      ) q)`,
      [{
        paymentId:      p.paymentId,
        requestHash:    p.requestHash,
        resultHash,
        sellerPassport: this.sellerAA,
        buyerPassport:  p.buyerAA,
        proofType:      ProofType.ORACLE,
        proofPayload:   proofSig,
        attestor:       oracleEOA.address,
        deliveredAt:    now,
        deadline:       p.deadline,
      }],
    );
    const settleResult = await aaSend(this.sdk, this.sellerEOA, process.env.REGISTRY_ADDRESS!, postCD);

    return {
      paymentId:      p.paymentId,
      escrowTx:       escrowResult.txHash,
      quittanceTx:    settleResult.txHash,
      blockNumber:    settleResult.blockNumber,
      settled:        true,
      usdcAmount:     fmt(p.amount),
      deliveryResult,
    };
  }
}

// ─── Facilitator-mediated settlement (v0.1 — when Pieverse is back) ───────────
//
// Drop-in replacement for OnChainSettlement. Same on-chain artefacts.
// Swap in via: settlement: { type: "facilitator", url: "https://facilitator.pieverse.io" }

class FacilitatorSettlement {
  private config: FacilitatorConfig;
  private inner:  OnChainSettlement;

  constructor(config: FacilitatorConfig) {
    this.config = config;
    this.inner  = new OnChainSettlement();
  }

  getSellerAA() { return this.inner.getSellerAA(); }
  getProvider() { return this.inner.getProvider(); }
  checkAllowance(buyerAA: string, required: bigint) {
    return this.inner.checkAllowance(buyerAA, required);
  }

  async settle<TPayload>(p: SettleParams<TPayload>): Promise<SettleResult> {
    // 1. Verify with Pieverse
    const verifyRes = await fetch(`${this.config.url}/v2/verify`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ paymentId: p.paymentId, buyerAA: p.buyerAA }),
    });
    if (!verifyRes.ok) {
      // Facilitator down — fall back to on-chain settlement transparently
      console.warn(`[quittance] Facilitator ${this.config.url} returned ${verifyRes.status}; falling back to on-chain settlement`);
      return this.inner.settle(p);
    }

    // 2. Deliver the service (same as on-chain path)
    const deliveryResult = await p.deliver(p.payload, {
      paymentId: p.paymentId, buyerAA: p.buyerAA,
      sellerAA: this.inner.getSellerAA(), amount: p.amount,
    });

    // 3. Settle with Pieverse
    const settleRes = await fetch(`${this.config.url}/v2/settle`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ paymentId: p.paymentId, deliveryResult }),
    });
    if (!settleRes.ok) {
      console.warn(`[quittance] Facilitator settle failed (${settleRes.status}); falling back to on-chain settlement`);
      return this.inner.settle(p);
    }

    const settled = await settleRes.json() as { quittanceTx: string; escrowTx: string; blockNumber: number };
    return {
      paymentId:      p.paymentId,
      escrowTx:       settled.escrowTx,
      quittanceTx:    settled.quittanceTx,
      blockNumber:    settled.blockNumber,
      settled:        true,
      usdcAmount:     fmt(p.amount),
      deliveryResult,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type AnySettlement = OnChainSettlement | FacilitatorSettlement;

export function makeSettlement(mode: SettlementMode = "onchain"): AnySettlement {
  if (mode === "onchain") return new OnChainSettlement();
  return new FacilitatorSettlement(mode);
}

export type { SettleParams };
