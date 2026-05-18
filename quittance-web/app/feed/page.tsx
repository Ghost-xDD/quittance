import type { Metadata } from "next";
import { FeedPageClient } from "./feed-client";

export const metadata: Metadata = {
  title: "Quittance Feed · Live on Kite",
  description: "Real-time stream of quittances settling on Kite mainnet. Watch proof-of-delivery events as they happen — ORACLE, COSIGN, ZKTLS, TEE, THRESHOLD.",
};

export default function FeedPage() {
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-10 md:px-10 md:py-14">
      <header className="mb-8">
        <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
          Live · QuittanceRegistry · Kite mainnet
        </p>
        <h1 className="mt-2 font-display text-[clamp(32px,4vw,54px)] font-light leading-none tracking-[-0.02em] text-print">
          Quittance <span className="italic text-print-dim">Feed</span>
        </h1>
        <p className="mt-4 max-w-[520px] text-[14px] leading-relaxed text-print-dim">
          Every row is an on-chain quittance event. PENDING → DELIVERED → SETTLED is the happy path.
          SLASHED means the seller&apos;s bond was seized for submitting an invalid proof.
        </p>
      </header>

      <div className="border border-seam bg-vellum-2/30" style={{ minHeight: 560 }}>
        <FeedPageClient />
      </div>

      {/* Status legend */}
      <div className="mt-8 flex flex-wrap gap-4">
        {[
          { label: "PENDING",   color: "text-print-faint border-seam-2",  desc: "Escrow opened, awaiting proof" },
          { label: "DELIVERED", color: "text-seal border-seal/50",        desc: "Proof submitted, verifying" },
          { label: "SETTLED",   color: "text-sage border-sage/50",        desc: "Proof verified, seller paid" },
          { label: "REFUNDED",  color: "text-print-dim border-seam-2",    desc: "Deadline passed, buyer refunded" },
          { label: "SLASHED",   color: "text-crimson border-crimson/50",  desc: "Invalid proof, bond seized" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2.5">
            <span
              className={`num inline-flex h-[22px] items-center border px-2.5 text-[10px] uppercase tracking-[0.2em] ${s.color}`}
            >
              {s.label}
            </span>
            <span className="text-[12.5px] text-print-faint">{s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
