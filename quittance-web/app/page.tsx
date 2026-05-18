"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import dynamic from "next/dynamic";

const QuittanceField = dynamic(
  () => import("@/components/quittance-field").then((m) => m.QuittanceField),
  { ssr: false },
);
const StampReveal = dynamic(
  () => import("@/components/stamp-reveal").then((m) => m.StampReveal),
  { ssr: false, loading: () => <span /> },
);
const CursorGlow = dynamic(
  () => import("@/components/cursor-glow").then((m) => m.CursorGlow),
  { ssr: false },
);
const ReceiptLedger = dynamic(
  () => import("@/components/receipt-ledger").then((m) => m.ReceiptLedger),
  { ssr: false },
);
const ProofStamp = dynamic(
  () => import("@/components/proof-stamp").then((m) => m.ProofStamp),
  { ssr: false },
);
const AdapterExhibit = dynamic(
  () => import("@/components/adapter-exhibit").then((m) => m.AdapterExhibit),
  { ssr: false },
);
const SDKSnippet = dynamic(
  () => import("@/components/sdk-snippet").then((m) => m.SDKSnippet),
  { ssr: false },
);
const PassportGallery = dynamic(
  () => import("@/components/passport-gallery").then((m) => m.PassportGallery),
  { ssr: false },
);

export default function Home() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 80, damping: 22 });

  return (
    <div id="top" className="relative">
      <CursorGlow />

      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="fixed left-0 right-0 top-0 z-50 h-[2px] origin-left bg-seal"
      />

      <Hero reduce={!!reduce} />
      <ReceiptLedger />
      <ProofStamp />
      <AtomicityBand />
      <AdapterExhibit />
      <SDKSnippet />
      <PassportGallery />
      <Manifesto />
    </div>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */

function Hero({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yHead = useTransform(scrollYProgress, [0, 1], ["0%", "-20%"]);
  const scaleHead = useTransform(scrollYProgress, [0, 1], [1, 0.85]);
  const opacityHead = useTransform(scrollYProgress, [0, 0.7, 1], [1, 0.7, 0]);
  const yBg = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const watermarkY = useTransform(scrollYProgress, [0, 1], ["0%", "-40%"]);
  const watermarkRot = useTransform(scrollYProgress, [0, 1], [0, -6]);

  return (
    <section ref={ref} className="relative min-h-[100vh] overflow-hidden">
      <motion.div style={{ y: yBg }} className="absolute inset-0">
        <QuittanceField spawnEvery={900} maxCells={10} />
      </motion.div>

      {/* 402 watermark — the HTTP status that started this whole thing. */}
      <motion.div
        aria-hidden
        style={{ y: watermarkY, rotate: watermarkRot }}
        className="pointer-events-none absolute right-[-4vw] top-[6vh] z-0 select-none"
      >
        <span
          className="block font-display font-light leading-none text-print"
          style={{
            fontSize: "clamp(180px, 28vw, 460px)",
            opacity: 0.045,
            letterSpacing: "-0.04em",
          }}
        >
          402
        </span>
      </motion.div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-40 h-[420px] opacity-50"
        style={{
          background:
            "radial-gradient(ellipse at center bottom, rgba(212,162,76,0.18) 0%, transparent 65%)",
        }}
      />
      <div className="grain absolute inset-0" />

      <motion.div
        style={{ y: yHead, scale: scaleHead, opacity: opacityHead }}
        className="relative mx-auto grid w-full max-w-[1320px] grid-cols-12 gap-x-6 gap-y-10 px-6 pt-24 pb-24 md:px-10 md:pt-36"
      >
        <div className="col-span-12 flex items-center gap-4 md:col-span-9">
          <span className="num text-[11px] uppercase tracking-[0.36em] text-seal">
            № 001 · Kite AI Hackathon 2026
          </span>
          <span className="h-px flex-1 bg-seam" />
          <span className="num hidden text-[11px] uppercase tracking-[0.28em] text-print-faint sm:inline">
            Agentic Commerce track
          </span>
        </div>

        <h1 className="col-span-12 font-display text-[clamp(48px,8.4vw,128px)] font-light leading-[0.93] tracking-[-0.022em] text-print">
          <Reveal delay={reduce ? 0 : 0.08}>
            <span className="text-print-faint">HTTP 402 says </span>
            <em className="font-medium italic text-seal">paid.</em>
          </Reveal>
          <Reveal delay={reduce ? 0 : 0.22}>
            Quittance proves <em className="font-medium italic text-seal">delivered.</em>
          </Reveal>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 0.6, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="col-span-12 max-w-[580px] text-[17px] leading-[1.55] text-print-dim md:col-span-7"
        >
          Quittance is the missing layer between &ldquo;the buyer paid&rdquo; and &ldquo;the seller
          actually delivered&rdquo; — escrow, verifiable proofs, bonds, and on-chain reputation.
          Watch an agent take a calculated risk, get protected, and settle — live on Kite mainnet.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 0.78, duration: 0.7 }}
          className="col-span-12 flex flex-wrap items-center gap-4 pt-2"
        >
          <Link
            href="/workspace"
            className="group relative inline-flex items-center gap-3 overflow-hidden border border-seal bg-seal px-7 py-3.5 text-[13px] font-medium uppercase tracking-[0.18em] text-ink transition-colors hover:border-seal-deep hover:bg-seal-deep"
          >
            <span className="relative">Open the workspace</span>
            <Arrow />
          </Link>
          <Link
            href="/leaderboard"
            className="group inline-flex items-center gap-3 px-2 py-3.5 text-[13px] font-medium uppercase tracking-[0.18em] text-print-dim transition-colors hover:text-print"
          >
            <span className="relative pb-1">
              View the leaderboard
              <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-50 bg-seam-2 transition-transform duration-300 group-hover:scale-x-100 group-hover:bg-print" />
            </span>
            <Arrow />
          </Link>
        </motion.div>

        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: reduce ? 0 : 0.95, duration: 0.8 }}
          className="col-span-12 mt-4 md:col-span-4 md:col-start-9 md:row-start-3 md:mt-0 md:flex md:flex-col md:items-end md:justify-end md:gap-3 md:pr-2"
        >
          <ReceiptSeal />
        </motion.aside>
      </motion.div>

      <PerforatedRail />
    </section>
  );
}

function ReceiptSeal() {
  return (
    <figure className="relative max-w-[280px] border border-seam/70 bg-vellum-2/40 p-5 backdrop-blur-sm">
      <div className="absolute -right-2 -top-2 grid h-12 w-12 place-items-center rounded-full border border-seal/60 bg-vellum/80">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="9" stroke="var(--seal)" strokeWidth="1.2" />
          <circle cx="11" cy="11" r="5" fill="var(--seal)" />
        </svg>
      </div>
      <p className="num text-[10px] uppercase tracking-[0.28em] text-print-faint">
        Receipt · № 0023412
      </p>
      <p className="mt-3 font-display text-[18px] font-light italic leading-snug text-print">
        &ldquo;The buyer trusts the protocol,
        <br />
        not the seller.&rdquo;
      </p>
      <figcaption className="num mt-4 flex items-center justify-between border-t border-seam pt-3 text-[9.5px] uppercase tracking-[0.24em] text-print-faint">
        <span>signed</span>
        <span className="text-seal">QUITTANCE</span>
      </figcaption>
    </figure>
  );
}

function PerforatedRail() {
  return (
    <div
      aria-hidden
      className="num pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-6 overflow-hidden border-t border-seam/70 bg-vellum-2/40 px-6 py-3 text-[10px] uppercase tracking-[0.28em] text-print-faint md:px-10"
    >
      <span className="text-seal">·</span>
      <span>exec</span>
      <Dashes />
      <span>pay</span>
      <Dashes />
      <span>deliver</span>
      <Dashes />
      <span>quittance</span>
      <Dashes />
      <span>settle</span>
      <span className="ml-auto text-seal">·</span>
    </div>
  );
}

function Dashes() {
  return <span className="h-px flex-1 bg-seam" />;
}

/* ─────────────── Atomicity band (Exec · Pay · Deliver) ─────────────── */

function AtomicityBand() {
  return (
    <section className="relative border-t border-seam">
      <div className="mx-auto grid max-w-[1320px] grid-cols-12 px-6 py-20 md:px-10 md:py-24">
        <header className="col-span-12 mb-12 md:col-span-8">
          <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
            Exec-Pay-Deliver atomicity
          </p>
          <h2 className="mt-3 font-display text-[clamp(32px,4.4vw,58px)] font-light leading-none tracking-[-0.02em] text-print">
            Three legs.
            <br />
            <em className="italic text-print-dim">One transaction.</em>
          </h2>
        </header>

        <ol className="col-span-12 grid grid-cols-1 gap-px overflow-hidden border border-seam bg-seam md:grid-cols-3">
          {[
            {
              k: "01",
              title: "Exec",
              body: "Seller executes the paid request. Result is hashed and committed.",
            },
            {
              k: "02",
              title: "Pay",
              body: "Buyer's USDC sits in escrow under a deadline — locked until proof or refund.",
            },
            {
              k: "03",
              title: "Deliver",
              body: "Quittance posts on-chain. Adapter verifies. Escrow releases in the same tx.",
            },
          ].map((s, i) => (
            <motion.li
              key={s.k}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.12, duration: 0.6 }}
              className="relative bg-vellum-2/40 p-7 md:p-10"
            >
              <div className="flex items-baseline justify-between border-b border-seam pb-4">
                <span className="num text-[11px] uppercase tracking-[0.28em] text-seal">
                  {s.k}
                </span>
                <span className="num text-[10px] uppercase tracking-[0.22em] text-print-faint">
                  atomic
                </span>
              </div>
              <h3 className="mt-5 font-display text-[34px] font-light italic leading-none tracking-tight text-print">
                {s.title}
              </h3>
              <p className="mt-4 max-w-[340px] text-[13.5px] leading-[1.65] text-print-dim">
                {s.body}
              </p>
              <AtomicPulse delay={i * 0.4} />
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AtomicPulse({ delay }: { delay: number }) {
  return (
    <motion.div
      aria-hidden
      className="mt-8 h-px w-full origin-left bg-seal/40"
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ delay, duration: 1, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

/* ─────────────────────── Manifesto ─────────────────────── */

function Manifesto() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const qY = useTransform(scrollYProgress, [0, 1], ["12%", "-12%"]);
  const qRot = useTransform(scrollYProgress, [0, 1], [-4, 4]);

  return (
    <section ref={ref} className="relative overflow-hidden border-t border-seam">
      <div className="absolute inset-0 receipt-grid opacity-30" />

      {/* Giant Q wordmark drifting on scroll. */}
      <motion.div
        aria-hidden
        style={{ y: qY, rotate: qRot }}
        className="pointer-events-none absolute -right-[6vw] top-1/2 -translate-y-1/2 select-none"
      >
        <span
          className="block font-display font-light italic leading-none text-seal"
          style={{
            fontSize: "clamp(320px, 48vw, 720px)",
            opacity: 0.12,
            letterSpacing: "-0.06em",
          }}
        >
          Q
        </span>
      </motion.div>

      <div className="relative mx-auto grid max-w-[1320px] grid-cols-12 gap-6 px-6 py-40 md:px-10">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="col-span-12 font-display text-[clamp(40px,6vw,90px)] font-light leading-none tracking-[-0.02em] text-print md:col-span-9"
        >
          <StampReveal text="Payment without delivery proof" charDelay={26} />
          <br />
          <StampReveal text="is only half an economy." charDelay={26} delay={500} />
          <br />
          <em className="italic text-seal">Quittance is the other half.</em>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ delay: 0.2, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="col-span-12 max-w-md text-[14px] leading-[1.7] text-print-dim md:col-span-3 md:pt-4"
        >
          Built for the Kite agentic economy: drop-in escrow, six proof adapters, a
          QuittanceEvaluatorHook for ERC-8183 marketplaces, and a reputation layer agents
          can query on-chain.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ delay: 0.35, duration: 0.7 }}
          className="col-span-12 mt-12 flex flex-wrap items-center gap-5 border-t border-seam pt-10"
        >
          <Link
            href="/workspace"
            className="group inline-flex items-center gap-3 border border-seal bg-seal px-7 py-3.5 text-[12px] font-medium uppercase tracking-[0.2em] text-ink transition-colors hover:border-seal-deep hover:bg-seal-deep"
          >
            Open the workspace
            <Arrow />
          </Link>
          <Link
            href="https://www.npmjs.com/package/@quittance/server"
            target="_blank"
            rel="noopener noreferrer"
            className="num inline-flex items-center gap-3 px-2 py-3.5 text-[11px] font-medium uppercase tracking-[0.2em] text-print-dim hover:text-print"
          >
            npm install @quittance/server <Arrow />
          </Link>
          <Link
            href="#top"
            className="num ml-auto inline-flex items-center gap-3 px-2 py-3.5 text-[11px] font-medium uppercase tracking-[0.2em] text-print-faint hover:text-print"
          >
            Back to top <Arrow />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

/* ─────────────────────── Helpers ─────────────────────── */

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <span className="block overflow-hidden">
      <motion.span
        initial={{ y: "110%" }}
        animate={{ y: 0 }}
        transition={{ delay, duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
        className="block"
      >
        {children}
      </motion.span>
    </span>
  );
}

function Arrow() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
      <path
        d="M1 5h11.5M8 1l4.5 4L8 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
      />
    </svg>
  );
}
