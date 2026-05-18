/**
 * @quittance/server
 *
 * Seller-side SDK for spec-compliant x402 with on-chain Exec-Pay-Deliver atomicity.
 *
 * Usage:
 *
 *   import { createSellerServer } from "@quittance/server";
 *
 *   createSellerServer({
 *     agentName: "my-service.kite",
 *     price: "1000",                        // 0.001 USDC (6 decimals)
 *     async deliver({ to, body }, meta) {
 *       await myService.send(to, body);
 *       return `delivered:${to}`;
 *     },
 *   }).listen(4002, "0.0.0.0");
 *
 * Settlement backend (default: "onchain" — facilitator-free):
 *
 *   // When Pieverse is back up, swap to facilitator-mediated with one line:
 *   settlement: { type: "facilitator", url: "https://facilitator.pieverse.io" }
 *
 *   Both paths produce identical on-chain artefacts. No buyer-side changes required.
 */

export { createSellerServer } from "./server.js";

export type {
  QuittanceServerConfig,
  DeliverFn,
  DeliverMeta,
  SettleResult,
  SettlementMode,
  FacilitatorConfig,
  BondTier,
  ProofKind,
} from "./types.js";
