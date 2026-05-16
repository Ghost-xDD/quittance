"use client";

import { useEffect, useState } from "react";
import { ProofBadge } from "./proof-badge";
import type { Seller, SellerTier } from "./types";
import Link from "next/link";

const TIER_COLORS: Record<SellerTier, string> = {
  gold:   "text-seal border-seal/50",
  silver: "text-print-dim border-seam-2",
  bronze: "text-print-faint border-seam/60",
};

const TIER_BG: Record<SellerTier, string> = {
  gold:   "bg-seal/10",
  silver: "bg-vellum-3/40",
  bronze: "bg-vellum-3/20",
};

const INITIAL_SELLERS: Seller[] = [
  { id: "sms-pro",      name: "sms.kite",        adapter: "ORACLE",    tier: "gold",   bond: 2.5,  successRate: 97.4, completed: 2841, avgLatencyMs: 1180, reputation: 96 },
  { id: "pricefeed",    name: "pricefeed.kite",   adapter: "THRESHOLD", tier: "gold",   bond: 3.0,  successRate: 99.1, completed: 5204, avgLatencyMs: 840,  reputation: 98 },
  { id: "translate-ai", name: "translate.kite",   adapter: "COSIGN",   tier: "silver", bond: 1.2,  successRate: 94.7, completed: 1103, avgLatencyMs: 2100, reputation: 88 },
  { id: "scrape",       name: "scrape.kite",      adapter: "ZKTLS",    tier: "silver", bond: 1.8,  successRate: 91.2, completed: 877,  avgLatencyMs: 3400, reputation: 82 },
  { id: "llm",          name: "llm.kite",         adapter: "TEE",      tier: "silver", bond: 1.5,  successRate: 88.9, completed: 624,  avgLatencyMs: 4200, reputation: 79 },
  { id: "sms-cheap",    name: "sms-cheap.kite",   adapter: "ORACLE",   tier: "bronze", bond: 0.5,  successRate: 71.2, completed: 418,  avgLatencyMs: 3800, reputation: 58 },
];

interface LeaderboardPanelProps {
  fullPage?: boolean;
  highlightId?: string;
}

export function LeaderboardPanel({ fullPage = false, highlightId }: LeaderboardPanelProps) {
  const [sellers, setSellers] = useState<Seller[]>(INITIAL_SELLERS);

  // Simulate minor stat drift to make it feel live
  useEffect(() => {
    if (fullPage) return;
    const id = setInterval(() => {
      setSellers((prev) =>
        prev.map((s) => ({
          ...s,
          completed: s.completed + (Math.random() < 0.3 ? 1 : 0),
          successRate: +(Math.min(99.9, Math.max(50, s.successRate + (Math.random() - 0.5) * 0.08))).toFixed(1),
        }))
      );
    }, 4000);
    return () => clearInterval(id);
  }, [fullPage]);

  const ranked = [...sellers].sort((a, b) => b.reputation - a.reputation);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between border-b border-seam/60 px-4 py-3 shrink-0">
        <div className="flex items-baseline gap-2.5">
          <span className="num text-[10px] uppercase tracking-[0.3em] text-seal">
            Sellers
          </span>
          <span className="num text-[9px] uppercase tracking-[0.22em] text-print-ghost">
            · ranked by reputation
          </span>
        </div>
        {!fullPage && (
          <Link
            href="/leaderboard"
            className="num text-[9px] uppercase tracking-[0.2em] text-print-ghost transition-colors hover:text-seal"
          >
            full →
          </Link>
        )}
      </div>

      <ol className="flex-1 overflow-y-auto divide-y divide-seam/40">
        {ranked.map((seller, i) => (
          <li
            key={seller.id}
            className={`relative flex items-center gap-3 px-4 py-2.5 transition-colors ${
              highlightId === seller.id ? "bg-seal/8" : "hover:bg-vellum-2/40"
            }`}
          >
            {/* Rank */}
            <span className="num w-4 shrink-0 text-[11px] font-medium text-print-ghost tabular-nums">
              {i + 1}
            </span>

            {/* Tier bar */}
            <div
              className={`h-8 w-0.5 shrink-0 rounded-full ${
                seller.tier === "gold" ? "bg-seal" : seller.tier === "silver" ? "bg-print-faint" : "bg-seam-2"
              }`}
            />

            {/* Name + adapter */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate">
                <span className="truncate text-[12.5px] font-medium text-print">
                  {seller.name}
                </span>
                <ProofBadge type={seller.adapter} size="sm" />
              </div>
              <div className="num mt-0.5 flex items-center gap-2.5 text-[10px] text-print-ghost">
                <span>
                  <span className="text-sage">{seller.successRate}%</span> success
                </span>
                <span>{seller.bond} <span className="text-print-ghost">PYUSD bond</span></span>
              </div>
            </div>

            {/* Reputation score */}
            <div className="shrink-0 text-right">
              <div className="num text-[13px] font-medium text-print-dim tabular-nums">
                {seller.reputation}
              </div>
              <div
                className={`num mt-0.5 inline-flex h-[16px] items-center border px-1.5 text-[8px] uppercase tracking-[0.18em] ${TIER_COLORS[seller.tier]} ${TIER_BG[seller.tier]}`}
              >
                {seller.tier}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Stats footer */}
      <div className="num flex items-center gap-4 border-t border-seam/40 px-4 py-2 text-[9px] uppercase tracking-[0.22em] text-print-ghost shrink-0">
        <span>
          <span className="text-seal">{ranked.filter((s) => s.tier === "gold").length}</span> gold
        </span>
        <span>
          <span className="text-print-dim">{ranked.filter((s) => s.tier === "silver").length}</span> silver
        </span>
        <span>
          <span className="text-print-faint">{ranked.filter((s) => s.tier === "bronze").length}</span> bronze
        </span>
        <span className="ml-auto text-print-ghost">QuittanceRegistry · kite-testnet</span>
      </div>
    </div>
  );
}
