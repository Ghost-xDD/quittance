"use client";

import { motion } from "motion/react";

/**
 * Typographic specimen of the six pluggable proof adapters. Each tile has a
 * unique glyph so the section reads as a catalogue rather than a feature
 * grid. Order matches the on-chain ProofType enum.
 */

type Adapter = {
  id: string;
  enum: number;
  name: string;
  one: string;
  body: string;
  status: "live" | "v0.1" | "research";
  Glyph: () => React.JSX.Element;
};

const ADAPTERS: Adapter[] = [
  {
    id: "oracle",
    enum: 0,
    name: "Oracle",
    one: "Signed attestation",
    body: "A trusted attestor signs the canonical proof bytes — the simplest, most flexible adapter. Most v1 modalities live here.",
    status: "live",
    Glyph: PenNib,
  },
  {
    id: "tee",
    enum: 1,
    name: "TEE",
    one: "Enclave-attested",
    body: "Hardware enclave produces a remote-attestation quote alongside the result. Trust shifts from the seller to the silicon.",
    status: "v0.1",
    Glyph: Enclave,
  },
  {
    id: "zktls",
    enum: 2,
    name: "zkTLS",
    one: "Session transcript",
    body: "Zero-knowledge proof of a TLS session — the seller proves it actually called the upstream API without revealing keys.",
    status: "research",
    Glyph: ZkTri,
  },
  {
    id: "cosign",
    enum: 3,
    name: "Co-sign",
    one: "Buyer + seller agree",
    body: "Buyer and seller both sign the result hash. Lightweight, cheap, and ideal when both sides can verify the artifact themselves.",
    status: "live",
    Glyph: Handshake,
  },
  {
    id: "threshold",
    enum: 4,
    name: "Threshold",
    one: "N-of-M attestors",
    body: "Multiple attestors converge on the same hash. Survives any single oracle going dark or being compromised.",
    status: "v0.1",
    Glyph: Threshold,
  },
  {
    id: "timeout",
    enum: 5,
    name: "Timeout",
    one: "Auto-refund",
    body: "Deadline passes with no quittance posted. Escrow returns to the buyer; seller bond is exposed to slashing.",
    status: "live",
    Glyph: Clock,
  },
];

const STATUS_LABEL: Record<Adapter["status"], { label: string; tone: string }> = {
  live: { label: "shipping v1", tone: "text-sage border-sage/40" },
  "v0.1": { label: "shipping v1", tone: "text-seal border-seal/40" },
  research: { label: "research", tone: "text-print-faint border-seam-2" },
};

export function AdapterExhibit() {
  return (
    <section id="adapters" className="relative scroll-mt-28 border-t border-seam">
      <div className="mx-auto max-w-[1320px] px-6 py-32 md:px-10">
        <header className="mb-14 grid grid-cols-12 items-end gap-6">
          <div className="col-span-12 md:col-span-8">
            <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
              IProofAdapter · enum ProofType
            </p>
            <h2 className="mt-3 font-display text-[clamp(36px,5vw,68px)] font-light leading-none tracking-[-0.02em] text-print">
              Six ways to <em className="italic text-print-dim">prove</em> a delivery.
            </h2>
            <p className="mt-5 max-w-[520px] text-[14.5px] leading-[1.65] text-print-dim">
              Every quittance is verified by exactly one adapter contract. Bad proofs revert
              before settlement; good proofs trigger release in the same transaction.
            </p>
          </div>
          <p className="num col-span-12 text-right text-[10px] uppercase tracking-[0.28em] text-print-faint md:col-span-4">
            § Adapters · table 1
          </p>
        </header>

        <div className="grid grid-cols-12 border-t border-seam">
          {ADAPTERS.map((a, i) => (
            <motion.article
              key={a.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ delay: (i % 3) * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className={`group relative col-span-12 border-b border-seam p-7 md:col-span-6 md:p-9 lg:col-span-4 ${
                i % 3 !== 2 ? "lg:border-r lg:border-r-rule" : ""
              } ${i % 2 === 0 ? "md:border-r md:border-r-rule lg:border-r-rule" : ""}`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-px translate-y-full bg-linear-to-t from-seal/8 via-transparent to-transparent transition-transform duration-700 ease-out group-hover:translate-y-0"
              />

              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <span className="num block text-[10px] uppercase tracking-[0.28em] text-print-faint">
                    uint8 · {a.enum}
                  </span>
                  <h3 className="mt-2 font-display text-[34px] font-light italic leading-none tracking-[-0.01em] text-print">
                    {a.name}
                  </h3>
                  <p className="num mt-2 text-[11px] uppercase tracking-[0.22em] text-seal">
                    {a.one}
                  </p>
                </div>
                <div className="shrink-0 transition-transform duration-500 group-hover:rotate-6">
                  <a.Glyph />
                </div>
              </div>

              <p className="relative mt-7 max-w-[420px] text-[13.5px] leading-[1.65] text-print-dim">
                {a.body}
              </p>

              <div className="relative mt-8 flex items-center justify-between border-t border-seam pt-4">
                <span className="num text-[10px] uppercase tracking-[0.24em] text-print-faint">
                  contracts/adapters/{a.id}Adapter.sol
                </span>
                <span
                  className={`num inline-flex h-[20px] items-center border px-2 text-[9.5px] uppercase tracking-[0.22em] ${STATUS_LABEL[a.status].tone}`}
                >
                  {STATUS_LABEL[a.status].label}
                </span>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── Adapter glyphs ─────────────────────── */

function PenNib() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <path
        d="M22 4l11 19-11 17-11-17L22 4z"
        stroke="currentColor"
        strokeWidth="1.2"
        className="text-print-faint"
      />
      <path d="M22 4v36" stroke="var(--seal)" strokeWidth="1.2" />
      <circle cx="22" cy="24" r="3" fill="var(--seal)" />
    </svg>
  );
}

function Enclave() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <rect x="8" y="8" width="28" height="28" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <rect x="14" y="14" width="16" height="16" fill="var(--seal)" opacity="0.25" />
      <rect x="14" y="14" width="16" height="16" stroke="var(--seal)" strokeWidth="1.2" />
      <line x1="22" y1="4" x2="22" y2="8" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <line x1="22" y1="36" x2="22" y2="40" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <line x1="4" y1="22" x2="8" y2="22" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <line x1="36" y1="22" x2="40" y2="22" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
    </svg>
  );
}

function ZkTri() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <path d="M22 6L38 36H6L22 6z" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <path d="M22 6L30 22H14L22 6z" fill="var(--seal)" opacity="0.4" />
      <text x="22" y="32" textAnchor="middle" fontSize="9" fill="var(--seal)" fontFamily="serif" fontStyle="italic">
        zk
      </text>
    </svg>
  );
}

function Handshake() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <circle cx="16" cy="22" r="10" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <circle cx="28" cy="22" r="10" stroke="var(--seal)" strokeWidth="1.2" />
      <rect x="20" y="18" width="4" height="8" fill="var(--seal)" />
    </svg>
  );
}

function Threshold() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <circle cx="22" cy="22" r="16" stroke="currentColor" strokeWidth="1" className="text-print-faint" strokeDasharray="2 3" />
      {Array.from({ length: 7 }).map((_, i) => {
        const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
        const x = 22 + Math.cos(a) * 12;
        const y = 22 + Math.sin(a) * 12;
        const filled = i < 5;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2.6"
            fill={filled ? "var(--seal)" : "transparent"}
            stroke="var(--seal)"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}

function Clock() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <circle cx="22" cy="22" r="16" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <path d="M22 12v10l7 4" stroke="var(--seal)" strokeWidth="1.6" strokeLinecap="square" />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const x1 = 22 + Math.cos(a) * 15;
        const y1 = 22 + Math.sin(a) * 15;
        const x2 = 22 + Math.cos(a) * 16.5;
        const y2 = 22 + Math.sin(a) * 16.5;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth="1"
            className="text-print-faint"
          />
        );
      })}
    </svg>
  );
}
