"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";

/**
 * A scroll-driven proof-of-delivery animation: a paper receipt enters,
 * a marigold stamp descends and seals it, then the verified quittance
 * (seal + attestor signature) is revealed.
 *
 * The receipt is rendered in fixed editorial colors (cream paper + ink text)
 * so the metaphor reads identically in light and dark themes.
 */
export function ProofStamp() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  return (
    <section
      ref={ref}
      className="relative h-[260vh] border-t border-seam bg-vellum"
    >
      <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
        <header className="border-b border-seam px-6 py-6 md:px-10">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
                Anatomy of a quittance
              </p>
              <h2 className="mt-2 font-display text-[clamp(28px,3.6vw,46px)] font-light leading-none tracking-[-0.02em] text-print">
                Paper in. <span className="italic text-print-dim">Proof out.</span>
              </h2>
            </div>
            <ProgressBar progress={scrollYProgress} />
          </div>
        </header>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <Backdrop progress={scrollYProgress} />
          <Receipt progress={scrollYProgress} />
          <Stamp progress={scrollYProgress} />
        </div>
      </div>
    </section>
  );
}

function Receipt({ progress }: { progress: MotionValue<number> }) {
  const y = useTransform(progress, [0, 0.18], ["18vh", "0vh"]);
  const opacity = useTransform(progress, [0, 0.1], [0, 1]);

  const linesOpacity = [
    useTransform(progress, [0.08, 0.16], [0, 1]),
    useTransform(progress, [0.12, 0.20], [0, 1]),
    useTransform(progress, [0.16, 0.24], [0, 1]),
    useTransform(progress, [0.20, 0.28], [0, 1]),
    useTransform(progress, [0.24, 0.32], [0, 1]),
    useTransform(progress, [0.28, 0.36], [0, 1]),
    useTransform(progress, [0.32, 0.40], [0, 1]),
  ];

  const sealOpacity = useTransform(progress, [0.62, 0.74], [0, 1]);
  const sealScale = useTransform(progress, [0.62, 0.74], [0.8, 1]);
  const labelOpacity = useTransform(progress, [0.62, 0.74], [0, 1]);
  const awaitOpacity = useTransform(progress, [0, 0.58, 0.62], [1, 1, 0]);
  const sigOpacity = useTransform(progress, [0.78, 0.95], [0, 1]);
  const sigX = useTransform(progress, [0.78, 0.95], ["-14px", "0px"]);

  const lines = [
    ["paymentId", "0x91a3 47bc cf41 …"],
    ["requestHash", "0x77b2 0e91 2d10 …"],
    ["resultHash", "0x4c01 5a8d ee07 …"],
    ["adapter", "ORACLE · uint8(0)"],
    ["seller", "sms.kite"],
    ["attestor", "0x68d9 1f33 2e44 …"],
    ["deadline", "1779043200"],
  ];

  return (
    <motion.div
      style={{ y, opacity }}
      className="relative z-10 w-[min(86vw,520px)]"
    >
      <div
        className="relative shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]"
        style={{
          background: "#f5efe2",
          color: "#14110d",
          padding: "26px 30px 30px",
        }}
      >
        {/* Perforation strip top */}
        <Perforation />

        <div className="num flex items-baseline justify-between border-b border-[#cdb98b] pb-3 text-[10px] uppercase tracking-[0.32em] text-[#6e655a]">
          <span>Proof of delivery</span>
          <span>№ 0023412</span>
        </div>

        <ul className="mt-4 space-y-2">
          {lines.map(([k, v], i) => (
            <motion.li
              key={k}
              style={{ opacity: linesOpacity[i] }}
              className="num flex items-baseline justify-between gap-4 text-[11.5px] tracking-[0.06em]"
            >
              <span className="uppercase tracking-[0.24em] text-[#8a7d62]">{k}</span>
              <span className="text-[#14110d]">{v}</span>
            </motion.li>
          ))}
        </ul>

        <div className="relative mt-5 border-t border-[#cdb98b] pt-4">
          <motion.div
            style={{ opacity: awaitOpacity }}
            className="num text-center text-[10px] uppercase tracking-[0.32em] text-[#8a7d62]"
          >
            · awaiting proof ·
          </motion.div>

          <motion.div
            style={{ opacity: labelOpacity }}
            className="num absolute inset-x-0 top-4 text-center text-[10px] uppercase tracking-[0.32em] text-[#b07e2a]"
          >
            · quittance posted ·
          </motion.div>

          {/* Seal */}
          <motion.div
            style={{ opacity: sealOpacity, scale: sealScale }}
            className="mt-6 flex items-center justify-center"
          >
            <Seal />
          </motion.div>

          <motion.div
            style={{ opacity: sigOpacity, x: sigX }}
            className="num mt-5 flex items-baseline justify-between text-[10px] uppercase tracking-[0.22em] text-[#6e655a]"
          >
            <span>signed</span>
            <span className="text-[#14110d]">0x68d9 1f33 2e44 a01b</span>
          </motion.div>
        </div>

        <Perforation />
      </div>
    </motion.div>
  );
}

function Stamp({ progress }: { progress: MotionValue<number> }) {
  const y = useTransform(progress, [0.30, 0.58, 0.78], ["-58vh", "-14vh", "-78vh"]);
  const rotate = useTransform(progress, [0.30, 0.55, 0.58, 0.78], [-22, -2, 0, -8]);
  const scale = useTransform(progress, [0.55, 0.58, 0.62, 0.64], [1, 1.06, 0.94, 1]);
  const opacity = useTransform(progress, [0.28, 0.32, 0.78, 0.82], [0, 1, 1, 0]);
  const flashOpacity = useTransform(progress, [0.55, 0.58, 0.66], [0, 0.7, 0]);
  const flashScale = useTransform(progress, [0.55, 0.66], [0.4, 1.6]);

  return (
    <>
      <motion.div
        aria-hidden
        style={{ opacity: flashOpacity, scale: flashScale }}
        className="pointer-events-none absolute z-20 h-[280px] w-[280px] rounded-full"
        // Soft marigold burst at the moment of impact.
      >
        <div
          className="h-full w-full"
          style={{
            background:
              "radial-gradient(circle, rgba(212,162,76,0.55) 0%, rgba(212,162,76,0.15) 40%, transparent 70%)",
          }}
        />
      </motion.div>

      <motion.div
        aria-hidden
        style={{ y, rotate, scale, opacity }}
        className="pointer-events-none absolute z-30"
      >
        <StampMark />
      </motion.div>
    </>
  );
}

function StampMark() {
  return (
    <svg
      width="180"
      height="180"
      viewBox="0 0 180 180"
      fill="none"
      aria-hidden
      style={{ filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.35))" }}
    >
      <circle cx="90" cy="90" r="76" stroke="#b07e2a" strokeWidth="3" />
      <circle cx="90" cy="90" r="64" stroke="#b07e2a" strokeWidth="1.2" strokeDasharray="3 3" />
      <circle cx="90" cy="90" r="44" fill="#d4a24c" />
      <text
        x="90"
        y="86"
        textAnchor="middle"
        fontFamily="serif"
        fontSize="16"
        fontStyle="italic"
        fontWeight="500"
        fill="#0b0a09"
      >
        Quittance
      </text>
      <text
        x="90"
        y="104"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="8"
        letterSpacing="3"
        fill="#0b0a09"
      >
        VERIFIED
      </text>
      <text
        x="90"
        y="116"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="6"
        letterSpacing="2"
        fill="#0b0a09"
        opacity="0.65"
      >
        № 0023412 · KITE
      </text>
      {/* Tick marks around the outer ring */}
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const x1 = 90 + Math.cos(a) * 76;
        const y1 = 90 + Math.sin(a) * 76;
        const x2 = 90 + Math.cos(a) * 70;
        const y2 = 90 + Math.sin(a) * 70;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#b07e2a"
            strokeWidth="1.2"
          />
        );
      })}
    </svg>
  );
}

function Seal() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden>
      <circle cx="42" cy="42" r="36" stroke="#b07e2a" strokeWidth="1.6" />
      <circle cx="42" cy="42" r="30" stroke="#b07e2a" strokeWidth="0.8" strokeDasharray="2 2" />
      <text
        x="42"
        y="40"
        textAnchor="middle"
        fontFamily="serif"
        fontSize="11"
        fontStyle="italic"
        fill="#b07e2a"
      >
        Quittance
      </text>
      <text
        x="42"
        y="54"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="6"
        letterSpacing="2"
        fill="#b07e2a"
      >
        SETTLED
      </text>
    </svg>
  );
}

function Perforation() {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 h-[10px] first:-top-[5px] last:-bottom-[5px]"
      style={{
        backgroundImage: "radial-gradient(circle, #8a7d62 2.4px, transparent 3.2px)",
        backgroundSize: "14px 10px",
        backgroundPosition: "0 50%",
        backgroundRepeat: "repeat-x",
      }}
    />
  );
}

function Backdrop({ progress }: { progress: MotionValue<number> }) {
  const o1 = useTransform(progress, [0, 0.5, 1], [0.1, 0.2, 0.1]);
  return (
    <motion.div
      aria-hidden
      style={{ opacity: o1 }}
      className="absolute inset-0 pointer-events-none"
    >
      <div className="absolute inset-0 receipt-grid" />
    </motion.div>
  );
}

function ProgressBar({ progress }: { progress: MotionValue<number> }) {
  const w = useTransform(progress, [0, 1], ["0%", "100%"]);
  return (
    <div className="num flex flex-col items-end gap-2 text-[10px] uppercase tracking-[0.28em] text-print-faint">
      <span>scroll →</span>
      <span className="block h-px w-32 bg-seam-2">
        <motion.span style={{ width: w }} className="block h-full bg-seal" />
      </span>
    </div>
  );
}
