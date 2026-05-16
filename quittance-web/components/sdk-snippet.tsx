"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";

/**
 * Two side-by-side code surfaces — the server and client touchpoints of the
 * Quittance SDK. Lines stagger in when the section scrolls into view.
 *
 * Code is rendered as semantic spans so it themes via
 * the page's design tokens.
 */
export function SDKSnippet() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });

  return (
    <section id="sdk" className="relative scroll-mt-28 overflow-hidden border-t border-seam bg-vellum-2/20">
      <div className="mx-auto grid max-w-[1320px] grid-cols-12 gap-x-6 gap-y-10 px-6 py-32 md:px-10">
        <div className="col-span-12 lg:col-span-5">
          <p className="num text-[11px] uppercase tracking-[0.32em] text-seal">
            @quittance/sdk
          </p>
          <h2 className="mt-3 font-display text-[clamp(36px,5vw,68px)] font-light leading-none tracking-[-0.02em] text-print">
            Five lines.
            <br />
            <em className="italic text-print-dim">Two surfaces.</em>
          </h2>
          <p className="mt-5 max-w-[440px] text-[14.5px] leading-[1.65] text-print-dim">
            One wrapper on the server, one helper on the client. No new contracts to touch,
            no manual proofs to post — the SDK handles bonds, escrow, the registry, and the
            attestor handshake.
          </p>

          <dl className="num mt-10 grid grid-cols-2 gap-y-5 border-t border-seam pt-8 text-[11px] uppercase tracking-[0.22em] text-print-faint">
            <dt>install</dt>
            <dd className="text-print">npm i @quittance/sdk</dd>
            <dt>peer</dt>
            <dd className="text-print">x402-server ≥ 0.4</dd>
            <dt>gas</dt>
            <dd className="text-print">paid by relayer</dd>
            <dt>contracts</dt>
            <dd className="text-print">unchanged</dd>
          </dl>
        </div>

        <div ref={ref} className="col-span-12 flex flex-col gap-6 lg:col-span-7">
          <CodeSurface
            label="server.ts"
            tag="seller agent · x402 endpoint"
            inView={inView}
            lines={SERVER}
          />
          <CodeSurface
            label="client.ts"
            tag="buyer agent · gasless call"
            inView={inView}
            delay={0.5}
            lines={CLIENT}
          />
        </div>
      </div>
    </section>
  );
}

type Token = { t: "kw" | "str" | "fn" | "id" | "co" | "punct" | "num"; v: string };

function CodeSurface({
  label,
  tag,
  inView,
  lines,
  delay = 0,
}: {
  label: string;
  tag: string;
  inView: boolean;
  lines: Token[][];
  delay?: number;
}) {
  return (
    <article className="relative border border-seam bg-vellum/80 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)]">
      <header className="flex items-center justify-between border-b border-seam px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-crimson/70" />
          <span className="h-2 w-2 rounded-full bg-seal/70" />
          <span className="h-2 w-2 rounded-full bg-sage/70" />
          <span className="num ml-3 text-[10.5px] uppercase tracking-[0.22em] text-print-faint">
            {label}
          </span>
        </div>
        <span className="num text-[9.5px] uppercase tracking-[0.24em] text-print-faint">
          {tag}
        </span>
      </header>
      <pre className="num overflow-x-auto px-4 py-5 text-[12.5px] leading-[1.7]">
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }}
            transition={{ delay: delay + i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex gap-4"
          >
            <span className="select-none text-print-ghost" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <code className="whitespace-pre">{line.map((tok, j) => renderToken(tok, j))}</code>
          </motion.div>
        ))}
      </pre>
    </article>
  );
}

function renderToken(tok: Token, key: number) {
  const cls =
    tok.t === "kw"
      ? "text-seal"
      : tok.t === "str"
        ? "text-sage"
        : tok.t === "fn"
          ? "text-print"
          : tok.t === "co"
            ? "text-print-faint italic"
            : tok.t === "num"
              ? "text-seal"
              : "text-print-dim";
  return (
    <span key={key} className={cls}>
      {tok.v}
    </span>
  );
}

const SERVER: Token[][] = [
  [
    { t: "co", v: "// Protect any paid endpoint — bonds, escrow, registry post are handled." },
  ],
  [
    { t: "kw", v: "import" },
    { t: "id", v: " { quittance } " },
    { t: "kw", v: "from" },
    { t: "str", v: " \"@quittance/sdk\"" },
    { t: "punct", v: ";" },
  ],
  [],
  [
    { t: "id", v: "app." },
    { t: "fn", v: "post" },
    { t: "punct", v: "(" },
    { t: "str", v: "\"/exec\"" },
    { t: "punct", v: ", " },
    { t: "id", v: "quittance." },
    { t: "fn", v: "protect" },
    { t: "punct", v: "(" },
    { t: "kw", v: "async" },
    { t: "id", v: " (req) => " },
    { t: "punct", v: "{" },
  ],
  [
    { t: "id", v: "  " },
    { t: "kw", v: "const" },
    { t: "id", v: " result = " },
    { t: "kw", v: "await" },
    { t: "fn", v: " runJob" },
    { t: "punct", v: "(" },
    { t: "id", v: "req.body" },
    { t: "punct", v: ");" },
  ],
  [
    { t: "id", v: "  " },
    { t: "kw", v: "return" },
    { t: "id", v: " result" },
    { t: "punct", v: ";" },
    { t: "co", v: "  // SDK auto-posts ORACLE quittance." },
  ],
  [{ t: "punct", v: "}));" }],
];

const CLIENT: Token[][] = [
  [{ t: "co", v: "// Buyer agent — single call, gasless, auto-refund on timeout." }],
  [
    { t: "kw", v: "import" },
    { t: "id", v: " { quittance } " },
    { t: "kw", v: "from" },
    { t: "str", v: " \"@quittance/sdk\"" },
    { t: "punct", v: ";" },
  ],
  [],
  [
    { t: "kw", v: "const" },
    { t: "id", v: " receipt = " },
    { t: "kw", v: "await" },
    { t: "id", v: " quittance." },
    { t: "fn", v: "pay" },
    { t: "punct", v: "(" },
    { t: "str", v: "\"https://sms.kite/exec\"" },
    { t: "punct", v: ", {" },
  ],
  [
    { t: "id", v: "  body" },
    { t: "punct", v: ": { " },
    { t: "id", v: "to" },
    { t: "punct", v: ": " },
    { t: "str", v: "\"+1555…\"" },
    { t: "punct", v: ", " },
    { t: "id", v: "msg" },
    { t: "punct", v: ": " },
    { t: "str", v: "\"hi\"" },
    { t: "punct", v: " }," },
  ],
  [
    { t: "id", v: "  refundOn" },
    { t: "punct", v: ": " },
    { t: "str", v: "\"timeout\"" },
    { t: "punct", v: "," },
  ],
  [{ t: "punct", v: "});" }],
];
