import type * as http from "http";

// ─── Settlement result ─────────────────────────────────────────────────────────

export interface SettleResult {
  paymentId:      string;
  escrowTx:       string;
  quittanceTx:    string;
  blockNumber:    number;
  settled:        boolean;
  usdcAmount:     string;
  deliveryResult: string;
}

// ─── Delivery function ─────────────────────────────────────────────────────────

export interface DeliverMeta {
  paymentId: string;
  buyerAA:   string;
  sellerAA:  string;
  amount:    bigint;
}

export type DeliverFn<TPayload> = (
  payload: TPayload,
  meta:    DeliverMeta,
) => Promise<string>;

// ─── Bond tier ─────────────────────────────────────────────────────────────────

export type BondTier  = "bronze" | "silver" | "gold";
export type ProofKind = "oracle";

// ─── Settlement backends ───────────────────────────────────────────────────────

/**
 * "onchain"     — v0 facilitator-free path: seller calls openEscrow + Registry.post() directly.
 *                 No Pieverse dependency. Ships now.
 *
 * FacilitatorConfig — Pieverse-mediated path: POST /v2/verify + /v2/settle.
 *                 Swap in when the facilitator is back up. Zero seller-code changes required.
 */
export interface FacilitatorConfig {
  type: "facilitator";
  url:  string;
}

export type SettlementMode = "onchain" | FacilitatorConfig;

// ─── Main server config ────────────────────────────────────────────────────────

export interface QuittanceServerConfig<TPayload = Record<string, unknown>> {
  /** Display name registered in the Quittance marketplace. e.g. "email.kite" */
  agentName: string;

  /** Price per request, in settlement-token base units (e.g. "1000" = 0.001 USDC @ 6 dec). */
  price: bigint | string | number;

  /** Seconds the buyer has to complete the round-trip before refund fires. Default: 300. */
  deadlineSeconds?: number;

  /** Minimum seller bond tier the SDK advertises. Default: "bronze". */
  minBondTier?: BondTier;

  /**
   * Settlement backend.
   * - "onchain"        → facilitator-free (default, works today)
   * - FacilitatorConfig → routes through Pieverse when it's back up
   */
  settlement?: SettlementMode;

  /**
   * Cheap-mode: opens the escrow then intentionally skips delivery.
   * Escrow refunds the buyer and slashes the seller's bond at deadline.
   * Used for the demo Act 1 slash story.
   */
  cheapMode?:            boolean;
  cheapFailRate?:        number;   // fraction that fails, 0–1. default 0.8
  cheapDeadlineSeconds?: number;   // short deadline so refund fires fast. default 60

  /**
   * Deliver the service and return a short result string that becomes the
   * resultHash preimage. Throw to signal delivery failure (returns 500).
   */
  deliver: DeliverFn<TPayload>;

  /**
   * Optional: parse the raw JSON request body into a typed payload.
   * Defaults to passing the raw body object through as-is.
   * The parsed value is also used verbatim as the requestHash preimage
   * (JSON.stringify(payload)).
   */
  parseBody?: (raw: Record<string, unknown>) => TPayload;
}

export type { http };
