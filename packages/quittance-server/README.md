# @quittance/server

Seller-side SDK for [Quittance](https://quittance.xyz) — spec-compliant x402 with on-chain **Exec-Pay-Deliver atomicity** on Kite.

Turn any HTTP service into a bonded, verifiable x402 seller in under 10 lines. The SDK handles the full protocol: 402 negotiation, escrow opening, oracle proof, quittance post, and escrow release. You write the delivery logic. That's it.

```bash
npm install @quittance/server
```

---

## Quick start

```ts
import { createSellerServer } from "@quittance/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

createSellerServer<{ to: string; subject?: string; body?: string }>({
  agentName: "email.kite",
  price: "1000",              // 0.001 USDC (6 decimals)
  deadlineSeconds: 300,

  async deliver({ to, subject = "Delivery", body = "" }) {
    const { data, error } = await resend.emails.send({
      from: "you@yourdomain.com",
      to, subject, html: body,
    });
    if (error) throw new Error(error.message);
    return `email:${to}:${data?.id}`;
  },
}).listen(4002, "0.0.0.0");
```

On every incoming request the SDK:

1. **Round 1** — returns a spec-compliant HTTP 402 with the Quittance escrow address, proof type, and deadline embedded in `extra.quittance`.
2. **Round 2** — verifies the `X-PAYMENT` header, checks the buyer's on-chain allowance, opens escrow, calls your `deliver()` function, has the oracle sign the result hash, posts the quittance to `QuittanceRegistry`, and triggers escrow auto-release — all before returning `200`.

---

## Configuration

```ts
createSellerServer({
  // Required
  agentName:    string,             // name shown in the marketplace registry
  price:        bigint | string,    // settlement-token base units (e.g. "1000" = 0.001 USDC)
  deliver:      async (payload, meta) => string,  // your service — return a result string

  // Optional
  deadlineSeconds?:      number,    // default: 300
  minBondTier?:          "bronze" | "silver" | "gold",  // default: "bronze"
  parseBody?:            (raw) => TPayload,  // shape the incoming request body

  // Settlement backend (default: "onchain")
  settlement?:           "onchain" | { type: "facilitator"; url: string },

  // Demo slash story — opens escrow then intentionally skips delivery
  cheapMode?:            boolean,
  cheapFailRate?:        number,    // 0–1, default: 0.8
  cheapDeadlineSeconds?: number,    // default: 60
})
```

### Settlement backends

| Mode | How it works | When to use |
|---|---|---|
| `"onchain"` *(default)* | Seller calls `openEscrow` + `QuittanceRegistry.post()` directly. No facilitator dependency. | Now — works regardless of facilitator status. |
| `{ type: "facilitator", url }` | Routes through Pieverse `/v2/verify` + `/v2/settle`. Automatically falls back to on-chain if the facilitator returns non-200. | When [Pieverse](https://facilitator.pieverse.io) is available. |

Both paths produce identical on-chain artefacts (`EscrowOpened`, `QuittancePosted`, `EscrowReleased`). Switching is one config line — no buyer-side changes required.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `KITE_RPC_URL` | | Kite RPC endpoint. Default: `https://rpc.gokite.ai` |
| `KITE_BUNDLER_URL` | | ERC-4337 bundler. Default: Kite bundler |
| `USDC_ADDRESS` | ✓ | Settlement token contract address |
| `ESCROW_ADDRESS` | ✓ | Quittance Escrow contract address |
| `REGISTRY_ADDRESS` | ✓ | QuittanceRegistry contract address |
| `BOND_ADDRESS` | ✓ | Bond contract address |
| `ORACLE_PRIVATE_KEY` | ✓ | Oracle EOA private key (signs delivery proofs) |
| `SELLER_EMAIL_PRIVATE_KEY` | ✓ | Seller EOA private key (submits UserOps) |
| `TOKEN_DECIMALS` | | Default: `6` (USDC on mainnet) |

---

## Protocol

Quittance implements [Exec-Pay-Deliver atomicity](https://quittance.xyz) for x402:

- Buyer funds are escrowed on-chain before delivery begins.
- Seller delivers, then posts a cryptographic proof (oracle signature, adaptor-sig, threshold, TEE, zkTLS, or timeout).
- `QuittanceRegistry` verifies the proof and releases escrow to the seller atomically.
- If no proof is posted by `deadline`, anyone can call `refund()` — buyer gets USDC back, seller's bond is slashed.

**Contracts on Kite Mainnet (chainId 2366)** — see [quittance.xyz](https://quittance.xyz) for deployed addresses.

---

## Links

- [quittance.xyz](https://quittance.xyz) — live demo
- [github.com/Ghost-xDD/quittance](https://github.com/Ghost-xDD/quittance) — source
- [Kite Agent Passport](https://docs.gokite.ai/kite-agent-passport/kite-agent-passport)
- [x402 spec](https://github.com/gokite-ai/x402)
- [ERC-8183 — Agentic Commerce Protocol](https://eips.ethereum.org/EIPS/eip-8183)
