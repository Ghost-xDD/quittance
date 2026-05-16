import type { Metadata } from "next";
import { LeaderboardPanel } from "@/components/workspace/leaderboard-panel";
import { ProofBadge } from "@/components/workspace/proof-badge";
import type { ProofType } from "@/components/workspace/types";

export const metadata: Metadata = {
  title: "Leaderboard · Quittance",
  description: "Seller reputation rankings on the Quittance Protocol. Ranked by on-chain quittance history, bond size, and success rate.",
};

const ADAPTER_TYPES: ProofType[] = ["ORACLE", "COSIGN", "TEE", "ZKTLS", "THRESHOLD", "TIMEOUT"];

export default function LeaderboardPage() {
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-10 md:px-10 md:py-14">
      {/* Page header */}
      <header className="mb-10">
        <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
          QuittanceRegistry · kite-testnet
        </p>
        <h1 className="mt-2 font-display text-[clamp(32px,4vw,54px)] font-light leading-none tracking-[-0.02em] text-print">
          Seller <span className="italic text-print-dim">Leaderboard</span>
        </h1>
        <p className="mt-4 max-w-[520px] text-[14px] leading-relaxed text-print-dim">
          Sellers ranked by reputation — a bloom-filtered, bond-weighted score derived from completed
          quittances. Higher bond means more skin in the game. Slashing events permanently reduce score.
        </p>

        {/* Adapter legend */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {ADAPTER_TYPES.map((t) => (
            <ProofBadge key={t} type={t} size="md" />
          ))}
        </div>
      </header>

      {/* Full leaderboard */}
      <div className="border border-seam bg-vellum-2/30" style={{ minHeight: 480 }}>
        <LeaderboardPanel fullPage />
      </div>

      {/* How it works */}
      <section className="mt-12 grid gap-6 md:grid-cols-3">
        {[
          {
            title: "Bond",
            body: "Each seller posts a PYUSD bond before listing. The bond size signals commitment — larger bonds attract higher-value buyers and unlock Gold tier.",
          },
          {
            title: "Quittance",
            body: "Every completed delivery generates an on-chain quittance: a verifiable proof anchoring exec, pay, and deliver atomically. Failed deliveries trigger bond slashing.",
          },
          {
            title: "Reputation",
            body: "The ReputationView contract computes a bloom-filtered score that weights distinct counterparties, preventing Sybil inflation from repeated self-trades.",
          },
        ].map((card) => (
          <div key={card.title} className="border border-seam p-5">
            <p className="num text-[10px] uppercase tracking-[0.3em] text-seal">{card.title}</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-print-dim">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
