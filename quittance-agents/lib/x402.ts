/**
 * lib/x402.ts — x402 payment protocol types
 *
 * x402 adapts HTTP 402 "Payment Required" for agent-to-agent micropayments.
 * The protocol is two-round:
 *
 *   Round 1  POST /task (no payment)
 *            ← 402 { challenge }
 *
 *   Round 2  POST /task + X-Payment-* headers
 *            ← 200 { result, quittance }  |  400/500 error
 *
 * Payment authorisation headers (buyer → seller):
 *   X-Payment-Id        bytes32  paymentId derived by buyer
 *   X-Payment-Nonce     bytes32  nonce used in paymentId derivation
 *   X-Payment-Buyer     address  buyer's AA wallet address
 *   X-Payment-Amount    string   amount in wei
 *   X-Payment-Deadline  string   unix timestamp (seconds)
 */

// ─── Wire types ────────────────────────────────────────────────────────────────

/** Seller returns this in the 402 body */
export interface X402Challenge {
  required: true;
  amount: string;           // wei (18-decimal PYUSD)
  token: string;            // PYUSD contract address
  sellerPassport: string;   // seller AA wallet (funds land here)
  deadlineOffset: number;   // seconds the buyer has to pay
  taskId: string;           // opaque task correlation ID
}

/** Buyer sends these headers on the second request */
export interface X402PaymentHeaders {
  "X-Payment-Id":       string;  // bytes32 hex
  "X-Payment-Nonce":    string;  // bytes32 hex (random per payment)
  "X-Payment-Buyer":    string;  // buyer AA address
  "X-Payment-Amount":   string;  // wei
  "X-Payment-Deadline": string;  // unix seconds
}

/** Seller returns this on success */
export interface X402Settlement {
  taskId: string;
  result: string;
  paymentId: string;
  quittanceTx: string;
  blockNumber: number;
  settled: boolean;
}

// ─── Header helpers ────────────────────────────────────────────────────────────

export function parsePaymentHeaders(headers: Record<string, string | string[] | undefined>): X402PaymentHeaders | null {
  const get = (k: string) => {
    const v = headers[k.toLowerCase()] ?? headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const id       = get("x-payment-id");
  const nonce    = get("x-payment-nonce");
  const buyer    = get("x-payment-buyer");
  const amount   = get("x-payment-amount");
  const deadline = get("x-payment-deadline");
  if (!id || !nonce || !buyer || !amount || !deadline) return null;
  return {
    "X-Payment-Id":       id,
    "X-Payment-Nonce":    nonce,
    "X-Payment-Buyer":    buyer,
    "X-Payment-Amount":   amount,
    "X-Payment-Deadline": deadline,
  };
}

export function buildPaymentHeaders(
  paymentId: string,
  nonce: Uint8Array,
  buyerAA: string,
  amount: bigint,
  deadline: bigint,
): Record<string, string> {
  const { ethers } = require("ethers") as typeof import("ethers");
  return {
    "X-Payment-Id":       paymentId,
    "X-Payment-Nonce":    ethers.hexlify(nonce),
    "X-Payment-Buyer":    buyerAA,
    "X-Payment-Amount":   amount.toString(),
    "X-Payment-Deadline": deadline.toString(),
  };
}
