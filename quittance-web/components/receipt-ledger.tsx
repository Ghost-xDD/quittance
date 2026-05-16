"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * A live ledger of quittances posting on-chain. Receipts enter PENDING, then
 * transition through DELIVERED → SETTLED, REFUNDED, or (rarely) SLASHED.
 *
 * Deterministic on first paint to avoid hydration mismatches; the state
 * machine boots after mount.
 */

type Status = "PENDING" | "DELIVERED" | "SETTLED" | "REFUNDED" | "SLASHED";
type Adapter = "ORACLE" | "COSIGN" | "TIMEOUT" | "ZKTLS" | "TEE";

type Receipt = {
  id: string;
  t: string;
  seller: string;
  adapter: Adapter;
  amount: string;
  token: "PYUSD" | "USDC";
  status: Status;
  born: number;
};

const SELLERS = [
  "sms.kite",
  "scrape.kite",
  "llm.kite",
  "translator.kite",
  "pricefeed.kite",
];
const ADAPTERS: Adapter[] = ["ORACLE", "ORACLE", "ORACLE", "COSIGN", "TIMEOUT", "ZKTLS", "TEE"];
const AMOUNTS = ["0.05", "0.10", "0.25", "0.42", "1.20", "1.75", "3.75"];
const HASH_CHARS = "0123456789abcdef";

const STATUS_TONE: Record<Status, string> = {
  PENDING: "text-print-faint border-seam-2",
  DELIVERED: "text-seal border-seal/50",
  SETTLED: "text-sage border-sage/50",
  REFUNDED: "text-print-dim border-seam-2",
  SLASHED: "text-crimson border-crimson/50",
};

const INITIAL: Receipt[] = [
  { id: "0x1a87cf41", t: "14:02:11", seller: "sms.kite", adapter: "ORACLE", amount: "0.42", token: "PYUSD", status: "SETTLED", born: 0 },
  { id: "0x9b22ee07", t: "14:02:08", seller: "scrape.kite", adapter: "ORACLE", amount: "1.20", token: "PYUSD", status: "DELIVERED", born: 0 },
  { id: "0x4c0177a2", t: "14:02:04", seller: "llm.kite", adapter: "COSIGN", amount: "3.75", token: "PYUSD", status: "DELIVERED", born: 0 },
  { id: "0xee99b108", t: "14:01:59", seller: "translator.kite", adapter: "TIMEOUT", amount: "0.10", token: "PYUSD", status: "REFUNDED", born: 0 },
  { id: "0x77f52d10", t: "14:01:54", seller: "pricefeed.kite", adapter: "ORACLE", amount: "0.05", token: "PYUSD", status: "SETTLED", born: 0 },
  { id: "0x05c4be39", t: "14:01:50", seller: "sms.kite", adapter: "ORACLE", amount: "0.42", token: "PYUSD", status: "PENDING", born: 0 },
];

const MAX_ROWS = 7;

export function ReceiptLedger() {
  const [rows, setRows] = useState<Receipt[]>(INITIAL);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let counter = 1;

    const rand = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    const hash = () =>
      "0x" +
      Array.from({ length: 8 }, () => HASH_CHARS[Math.floor(Math.random() * 16)]).join("");
    const ts = () => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    };

    const tickIn = setInterval(() => {
      setRows((curr) => {
        const next: Receipt = {
          id: hash(),
          t: ts(),
          seller: rand(SELLERS),
          adapter: rand(ADAPTERS),
          amount: rand(AMOUNTS),
          token: "PYUSD",
          status: "PENDING",
          born: counter++,
        };
        const out = [next, ...curr];
        return out.length > MAX_ROWS ? out.slice(0, MAX_ROWS) : out;
      });
    }, 2200);

    const tickFlow = setInterval(() => {
      setRows((curr) =>
        curr.map((r) => {
          if (r.status === "PENDING") {
            const roll = Math.random();
            if (roll < 0.78) return { ...r, status: "DELIVERED" };
            if (roll < 0.93) return { ...r, status: "REFUNDED" };
            return { ...r, status: "SLASHED" };
          }
          if (r.status === "DELIVERED" && Math.random() < 0.55) {
            return { ...r, status: "SETTLED" };
          }
          return r;
        }),
      );
    }, 1100);

    const heartbeat = setInterval(() => setNow((n) => n + 1), 1000);

    return () => {
      clearInterval(tickIn);
      clearInterval(tickFlow);
      clearInterval(heartbeat);
    };
  }, []);

  const stats = useMemo(() => {
    const settled = rows.filter((r) => r.status === "SETTLED").length;
    const inFlight = rows.filter((r) => r.status === "PENDING" || r.status === "DELIVERED").length;
    const failed = rows.filter((r) => r.status === "REFUNDED" || r.status === "SLASHED").length;
    return { settled, inFlight, failed };
  }, [rows]);

  return (
    <section className="relative border-y border-seam bg-vellum-2/30">
      <div className="mx-auto max-w-[1320px] px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-seam pb-4">
          <div className="flex items-baseline gap-4">
            <span className="num text-[11px] uppercase tracking-[0.32em] text-seal">
              Live ledger
            </span>
            <span className="num text-[10px] uppercase tracking-[0.28em] text-print-faint">
              QuittanceRegistry · kite-testnet
            </span>
          </div>
          <div className="num flex items-center gap-5 text-[10px] uppercase tracking-[0.22em] text-print-faint">
            <Pulse />
            <span>
              <span className="text-sage">{stats.settled}</span> settled
            </span>
            <span>
              <span className="text-seal">{stats.inFlight}</span> in-flight
            </span>
            <span>
              <span className="text-crimson">{stats.failed}</span> failed
            </span>
            <span aria-hidden className="hidden md:inline" data-now={now}>
              tick
            </span>
          </div>
        </div>

        <ol className="num mt-2 divide-y divide-rule/60 text-[12.5px]">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((r) => (
              <motion.li
                key={r.born + r.id}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 14, transition: { duration: 0.25 } }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="grid grid-cols-[68px_110px_1fr_120px_120px] items-center gap-3 py-3 md:grid-cols-[78px_140px_1fr_160px_180px]"
              >
                <span className="text-print-faint">{r.t}</span>
                <StatusPill status={r.status} />
                <span className="truncate text-print">{r.seller}</span>
                <span className="hidden text-print-dim md:inline">
                  {r.amount} <span className="text-print-faint">{r.token}</span>{" "}
                  <span className="text-print-faint">· {r.adapter}</span>
                </span>
                <span className="truncate text-print-faint md:text-print-dim">{r.id}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <motion.span
      layout
      key={status}
      initial={{ opacity: 0.4, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={`inline-flex h-[22px] items-center justify-center border px-2.5 text-[10px] uppercase tracking-[0.22em] ${STATUS_TONE[status]}`}
    >
      {status}
    </motion.span>
  );
}

function Pulse() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-50" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-sage" />
    </span>
  );
}
