"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ProofBadge } from "./proof-badge";
import type { ProofType, QuittanceEvent, QuittanceStatus } from "./types";
import Link from "next/link";

const STATUS_STYLE: Record<QuittanceStatus, string> = {
  PENDING:   "text-print-faint border-seam-2",
  DELIVERED: "text-seal border-seal/50",
  SETTLED:   "text-sage border-sage/50",
  REFUNDED:  "text-print-dim border-seam-2",
  SLASHED:   "text-crimson border-crimson/50",
};

const SELLERS = ["sms.kite", "pricefeed.kite", "translate.kite", "scrape.kite", "llm.kite", "sms-cheap.kite"];
const ADAPTERS: ProofType[] = ["ORACLE", "ORACLE", "ORACLE", "COSIGN", "ZKTLS", "TEE", "THRESHOLD"];
const AMOUNTS = [0.001, 0.005, 0.01, 0.025, 0.1, 0.25, 1.0];
const HEX = "0123456789abcdef";

function rng<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)]; }
function mkHash() { return "0x" + Array.from({ length: 8 }, () => HEX[Math.floor(Math.random() * 16)]).join(""); }
function mkPaymentId() { return "0x" + Array.from({ length: 8 }, () => HEX[Math.floor(Math.random() * 16)]).join(""); }
function nowMs() { return Date.now(); }

const SEED: QuittanceEvent[] = [
  { id: "1", paymentId: "0x1a87cf41", timestamp: nowMs() - 18000, seller: "sms.kite",        adapter: "ORACLE",    amount: 0.001, status: "SETTLED" },
  { id: "2", paymentId: "0x9b22ee07", timestamp: nowMs() - 35000, seller: "pricefeed.kite",  adapter: "THRESHOLD", amount: 0.025, status: "SETTLED" },
  { id: "3", paymentId: "0x4c01bb08", timestamp: nowMs() - 62000, seller: "translate.kite",  adapter: "COSIGN",    amount: 0.1,   status: "DELIVERED" },
  { id: "4", paymentId: "0xee99b108", timestamp: nowMs() - 91000, seller: "sms-cheap.kite",  adapter: "ORACLE",    amount: 0.001, status: "REFUNDED" },
  { id: "5", paymentId: "0x77f52d10", timestamp: nowMs() -128000, seller: "scrape.kite",     adapter: "ZKTLS",     amount: 0.05,  status: "SETTLED" },
];

function relTime(ts: number, referenceMs: number) {
  const s = Math.floor((referenceMs - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

interface FeedPanelProps {
  fullPage?: boolean;
  injectEvent?: QuittanceEvent | null;
}

export function FeedPanel({ fullPage = false, injectEvent }: FeedPanelProps) {
  const [events, setEvents] = useState<QuittanceEvent[]>(SEED);
  const [clock, setClock] = useState(() => Date.now());

  // Inject external events (e.g. from the demo engine)
  useEffect(() => {
    if (!injectEvent) return;
    queueMicrotask(() => {
      setEvents((prev) => [injectEvent, ...prev].slice(0, 30));
    });
  }, [injectEvent]);

  // Simulated live feed
  useEffect(() => {
    let counter = 100;
    const spawnInterval = setInterval(() => {
      const ev: QuittanceEvent = {
        id: String(counter++),
        paymentId: mkPaymentId(),
        timestamp: nowMs(),
        seller: rng(SELLERS),
        adapter: rng(ADAPTERS),
        amount: rng(AMOUNTS),
        status: "PENDING",
      };
      setEvents((prev) => [ev, ...prev].slice(0, 30));
    }, 3500);

    const progressInterval = setInterval(() => {
      setEvents((prev) =>
        prev.map((e) => {
          if (e.status === "PENDING") {
            const roll = Math.random();
            if (roll < 0.72) return { ...e, status: "DELIVERED" as QuittanceStatus };
            if (roll < 0.9)  return { ...e, status: "REFUNDED" as QuittanceStatus };
            return { ...e, status: "SLASHED" as QuittanceStatus };
          }
          if (e.status === "DELIVERED" && Math.random() < 0.6) {
            return { ...e, status: "SETTLED" as QuittanceStatus, txHash: mkHash() };
          }
          return e;
        })
      );
    }, 1200);

    const heartbeat = setInterval(() => setClock(Date.now()), 5000);

    return () => {
      clearInterval(spawnInterval);
      clearInterval(progressInterval);
      clearInterval(heartbeat);
    };
  }, []);

  const stats = useMemo(() => ({
    settled:  events.filter((e) => e.status === "SETTLED").length,
    inFlight: events.filter((e) => e.status === "PENDING" || e.status === "DELIVERED").length,
    failed:   events.filter((e) => e.status === "REFUNDED" || e.status === "SLASHED").length,
  }), [events]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-seam/60 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <LiveDot />
          <span className="num text-[10px] uppercase tracking-[0.3em] text-seal">Feed</span>
          <span className="num text-[9px] uppercase tracking-[0.22em] text-print-ghost">
            · QuittanceRegistry
          </span>
        </div>
        <div className="num flex items-center gap-3 text-[9px] uppercase tracking-[0.18em] text-print-ghost">
          <span><span className="text-sage">{stats.settled}</span> settled</span>
          <span><span className="text-seal">{stats.inFlight}</span> live</span>
          <span><span className="text-crimson">{stats.failed}</span> failed</span>
          {!fullPage && (
            <Link href="/feed" className="ml-1 transition-colors hover:text-seal">full →</Link>
          )}
        </div>
      </div>

      <ol className="flex-1 overflow-y-auto divide-y divide-seam/30">
        <AnimatePresence initial={false} mode="popLayout">
          {events.map((ev) => (
            <motion.li
              key={ev.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="flex items-center gap-2 px-4 py-2 hover:bg-vellum-2/30"
            >
              <StatusPip status={ev.status} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="num truncate text-[11.5px] text-print">{ev.seller}</span>
                  <ProofBadge type={ev.adapter} size="sm" />
                </div>
                <div className="num mt-0.5 flex items-center gap-1.5 text-[9.5px] text-print-ghost">
                  <span className="text-print-faint">{ev.amount} USDC</span>
                  <span>·</span>
                  <span>{relTime(ev.timestamp, clock)}</span>
                </div>
              </div>

              <span
                className={`num shrink-0 inline-flex h-[18px] items-center border px-1.5 text-[8.5px] uppercase tracking-[0.16em] ${STATUS_STYLE[ev.status]}`}
              >
                {ev.status}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function StatusPip({ status }: { status: QuittanceStatus }) {
  const colors: Record<QuittanceStatus, string> = {
    PENDING:   "bg-print-ghost",
    DELIVERED: "bg-seal",
    SETTLED:   "bg-sage",
    REFUNDED:  "bg-print-faint",
    SLASHED:   "bg-crimson",
  };
  return (
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors[status]}`} />
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-50" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-sage" />
    </span>
  );
}
