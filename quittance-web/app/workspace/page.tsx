"use client";

import { useState, useCallback } from "react";
import { AgentChat } from "@/components/workspace/agent-chat";
import { LeaderboardPanel } from "@/components/workspace/leaderboard-panel";
import { FeedPanel } from "@/components/workspace/feed-panel";
import { WalletStrip } from "@/components/workspace/wallet-strip";
import { QuittanceMark } from "@/components/quittance-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import type { QuittanceEvent } from "@/components/workspace/types";
import Link from "next/link";

export default function WorkspacePage() {
  const [latestEvent, setLatestEvent] = useState<QuittanceEvent | null>(null);

  const handleQuittanceEvent = useCallback((ev: QuittanceEvent) => {
    setLatestEvent(ev);
  }, []);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-vellum text-print"
      data-theme="light"
    >
      {/* Workspace nav bar — minimal, no full site chrome */}
      <header className="flex shrink-0 items-center justify-between border-b border-seam/60 bg-vellum/90 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-baseline gap-1.5 group">
            <QuittanceMark />
            <span className="font-display text-[15px] font-light tracking-tight text-print">
              Quittance
            </span>
          </Link>
          <span className="h-3.5 w-px bg-seam-2" />
          <span className="num text-[11px] uppercase tracking-[0.28em] text-print-faint">
            Workspace
          </span>
        </div>

        <nav className="num hidden items-center gap-0.5 text-[11px] md:flex">
          <NavLink href="/leaderboard">Leaderboard</NavLink>
          <NavLink href="/feed">Feed</NavLink>
          <NavLink href="/#adapters">Adapters</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <NetworkPill />
          <ThemeToggle />
        </div>
      </header>

      {/* Three-panel body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: Chat panel (~70%) */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-seam/60">
          <AgentChat onQuittanceEvent={handleQuittanceEvent} />
        </div>

        {/* Right: 30% width, split 50/50 vertically */}
        <div className="flex w-[30%] min-w-[280px] max-w-[400px] flex-col border-l border-seam/30">
          {/* Top half: Leaderboard */}
          <div className="flex h-1/2 min-h-0 flex-col border-b border-seam/60">
            <LeaderboardPanel />
          </div>

          {/* Bottom half: Feed */}
          <div className="flex h-1/2 min-h-0 flex-col">
            <FeedPanel injectEvent={latestEvent} />
          </div>
        </div>
      </div>

      {/* Bottom: wallet strip */}
      <WalletStrip />
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 uppercase tracking-[0.2em] text-print-faint transition-colors hover:text-print"
    >
      {children}
    </Link>
  );
}

function NetworkPill() {
  return (
    <span className="num hidden items-center gap-1.5 rounded-full border border-seam px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-print-ghost sm:inline-flex">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-40" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-sage" />
      </span>
      Kite
    </span>
  );
}
