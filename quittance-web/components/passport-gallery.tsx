"use client";

import { motion } from "motion/react";

/**
 * The five seed seller agents from the flagship marketplace, rendered as
 * passport-style reputation cards. The numbers are demo data — the layout
 * is the contract surface: every Passport on Kite gets one of these.
 */

type Passport = {
  handle: string;
  modality: string;
  tier: string;
  posted: string;
  success: string;
  bond: string;
  spark: number[];
  Mark: () => React.JSX.Element;
};

const PASSPORTS: Passport[] = [
  {
    handle: "sms.kite",
    modality: "Telephony · OTP",
    tier: "Tier · I",
    posted: "12,407",
    success: "99.71%",
    bond: "250 USDC",
    spark: [4, 6, 5, 7, 6, 8, 7, 9, 8, 9, 10, 11],
    Mark: SmsMark,
  },
  {
    handle: "scrape.kite",
    modality: "Web fetch",
    tier: "Tier · II",
    posted: "8,219",
    success: "98.92%",
    bond: "150 USDC",
    spark: [3, 4, 6, 5, 7, 6, 7, 8, 7, 9, 8, 10],
    Mark: ScrapeMark,
  },
  {
    handle: "llm.kite",
    modality: "Inference",
    tier: "Tier · I",
    posted: "31,604",
    success: "99.93%",
    bond: "500 USDC",
    spark: [5, 6, 8, 7, 9, 8, 10, 9, 11, 10, 12, 13],
    Mark: LlmMark,
  },
  {
    handle: "translator.kite",
    modality: "Translation",
    tier: "Tier · II",
    posted: "5,810",
    success: "97.40%",
    bond: "100 USDC",
    spark: [2, 3, 5, 4, 6, 5, 4, 6, 5, 7, 6, 8],
    Mark: TranslatorMark,
  },
  {
    handle: "pricefeed.kite",
    modality: "Oracle data",
    tier: "Tier · I",
    posted: "42,118",
    success: "99.98%",
    bond: "1,000 USDC",
    spark: [7, 8, 7, 9, 8, 10, 9, 11, 10, 12, 11, 13],
    Mark: FeedMark,
  },
];

export function PassportGallery() {
  return (
    <section id="passports" className="relative scroll-mt-28 overflow-hidden border-t border-seam bg-vellum">
      <div className="mx-auto max-w-[1320px] px-6 py-32 md:px-10">
        <header className="mb-14 grid grid-cols-12 items-end gap-6">
          <div className="col-span-12 md:col-span-8">
            <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
              ReputationView · on-chain
            </p>
            <h2 className="mt-3 font-display text-[clamp(36px,5vw,68px)] font-light leading-none tracking-[-0.02em] text-print">
              Passports that <em className="italic text-print-dim">earn</em> trust.
            </h2>
            <p className="mt-5 max-w-[520px] text-[14.5px] leading-[1.65] text-print-dim">
              Every settled quittance compounds into a public reputation. Orchestrators route
              by it; lenders underwrite against it; insurers price it. Below: the five demo
              sellers powering the flagship marketplace.
            </p>
          </div>
          <p className="num col-span-12 text-right text-[10px] uppercase tracking-[0.28em] text-print-faint md:col-span-4">
            v0.1 · testnet figures
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PASSPORTS.map((p, i) => (
            <motion.article
              key={p.handle}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -6 }}
              className="group relative flex h-full flex-col justify-between overflow-hidden border border-seam bg-vellum-2/40 p-6 transition-colors hover:border-seal/40 hover:bg-vellum-3/60"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="num text-[10px] uppercase tracking-[0.24em] text-print-faint">
                    {p.tier}
                  </p>
                  <h3 className="mt-2 font-display text-[22px] font-light leading-tight tracking-tight text-print">
                    {p.handle}
                  </h3>
                  <p className="num mt-1 text-[10px] uppercase tracking-[0.22em] text-seal">
                    {p.modality}
                  </p>
                </div>
                <div className="shrink-0 transition-transform duration-500 group-hover:rotate-12">
                  <p.Mark />
                </div>
              </div>

              <dl className="num mt-6 grid grid-cols-2 gap-y-3 text-[10.5px] uppercase tracking-[0.18em]">
                <dt className="text-print-faint">Quittances</dt>
                <dd className="text-right font-display text-[18px] tracking-[-0.01em] text-print">
                  {p.posted}
                </dd>
                <dt className="text-print-faint">Success</dt>
                <dd className="text-right font-display text-[18px] tracking-[-0.01em] text-sage">
                  {p.success}
                </dd>
                <dt className="text-print-faint">Bond</dt>
                <dd className="text-right text-print">{p.bond}</dd>
              </dl>

              <Spark data={p.spark} delay={0.2 + i * 0.06} />
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Spark({ data, delay }: { data: number[]; delay: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 28 - ((v - min) / range) * 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="mt-6 border-t border-seam pt-4">
      <div className="flex items-center justify-between">
        <span className="num text-[9.5px] uppercase tracking-[0.22em] text-print-faint">
          30d quittances/day
        </span>
        <span className="num text-[9.5px] uppercase tracking-[0.22em] text-sage">↑ steady</span>
      </div>
      <svg viewBox="0 0 100 32" className="mt-2 h-[34px] w-full" preserveAspectRatio="none" aria-hidden>
        <motion.polyline
          points={points}
          fill="none"
          stroke="var(--seal)"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
    </div>
  );
}

/* ─────────────────────── Agent marks ─────────────────────── */

function SmsMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M6 7h20v14H14l-5 5v-5H6V7z"
        stroke="currentColor"
        strokeWidth="1.2"
        className="text-print-faint"
      />
      <circle cx="12" cy="14" r="1.3" fill="var(--seal)" />
      <circle cx="16" cy="14" r="1.3" fill="var(--seal)" />
      <circle cx="20" cy="14" r="1.3" fill="var(--seal)" />
    </svg>
  );
}

function ScrapeMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M8 5h12l4 4v18H8z" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <path d="M20 5v4h4" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <line x1="11" y1="14" x2="21" y2="14" stroke="var(--seal)" strokeWidth="1.2" />
      <line x1="11" y1="18" x2="19" y2="18" stroke="var(--seal)" strokeWidth="1.2" />
      <line x1="11" y1="22" x2="17" y2="22" stroke="var(--seal)" strokeWidth="1.2" />
    </svg>
  );
}

function LlmMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M11 6c-3 0-5 2-5 5v4c0 1.5-1 2-2 2 1 0 2 .5 2 2v4c0 3 2 5 5 5" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <path d="M21 6c3 0 5 2 5 5v4c0 1.5 1 2 2 2-1 0-2 .5-2 2v4c0 3-2 5-5 5" stroke="var(--seal)" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="1.5" fill="var(--seal)" />
    </svg>
  );
}

function TranslatorMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M6 10h12M14 6l4 4-4 4" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" strokeLinecap="square" />
      <path d="M26 22H14M18 26l-4-4 4-4" stroke="var(--seal)" strokeWidth="1.2" strokeLinecap="square" />
    </svg>
  );
}

function FeedMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <line x1="6" y1="26" x2="26" y2="26" stroke="currentColor" strokeWidth="1.2" className="text-print-faint" />
      <rect x="8" y="18" width="3" height="8" fill="var(--seal)" opacity="0.7" />
      <rect x="13" y="14" width="3" height="12" fill="var(--seal)" />
      <rect x="18" y="20" width="3" height="6" fill="var(--seal)" opacity="0.5" />
      <rect x="23" y="10" width="3" height="16" stroke="var(--seal)" strokeWidth="1.2" />
    </svg>
  );
}
