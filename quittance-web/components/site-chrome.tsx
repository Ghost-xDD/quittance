"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { QuittanceMark } from "@/components/quittance-mark";

const NAV = [
  { href: "/#adapters", label: "Adapters" },
  { href: "/#sdk", label: "SDK" },
  { href: "/#passports", label: "Passports" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/feed", label: "Feed" },
  { href: "/workspace", label: "Workspace" },
];

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    queueMicrotask(() => setMobileOpen(false));
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMobileOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mobileOpen]);

  // Workspace gets its own full-viewport layout — no chrome wrapper
  if (pathname?.startsWith("/workspace")) {
    return <>{children}</>;
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-seam/60 bg-vellum/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-4 py-3.5 md:px-10 md:py-4">
          <Link href="/#top" className="group flex shrink-0 items-baseline gap-2">
            <QuittanceMark />
            <span className="font-display text-[18px] font-light tracking-tight text-print md:text-[19px]">
              Quittance
            </span>
            <span className="num hidden text-[10px] uppercase tracking-[0.28em] text-print-faint lg:inline">
              · Proof-of-delivery
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="relative px-4 py-2 text-[13px] font-medium tracking-wide text-print-dim transition-colors hover:text-print"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-seam px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-print-faint sm:inline-flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-40" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-sage" />
              </span>
              Kite
            </span>
            <ThemeToggle />
            <div ref={menuRef} className="relative md:hidden">
              <button
                type="button"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen((o) => !o)}
                className="grid h-[34px] w-[34px] place-items-center border border-seam text-print-dim transition-colors hover:border-print-faint hover:text-print"
              >
                {mobileOpen ? <CloseIcon /> : <MenuIcon />}
              </button>
              <AnimatePresence>
                {mobileOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 top-[calc(100%+8px)] w-[200px] origin-top-right border border-seam bg-vellum-2 shadow-2xl"
                  >
                    <ul className="p-1.5">
                      {NAV.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className="flex items-center px-3 py-2.5 text-[13px] font-medium text-print-dim transition-colors hover:bg-vellum-3/40 hover:text-print"
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col">{children}</main>

      <footer className="border-t border-seam/60 bg-vellum-2/40">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 py-6 text-[10px] text-print-faint md:flex-row md:items-center md:justify-between md:px-10 md:py-7 md:text-[11px]">
          <p className="num uppercase tracking-[0.24em] md:tracking-[0.28em]">
            Quittance · Exec-Pay-Deliver for agent commerce on Kite
          </p>
          <p className="num uppercase tracking-[0.24em] md:tracking-[0.28em]">
            x402 · Escrow · ERC-8183 hook
          </p>
        </div>
      </footer>
    </div>
  );
}


function MenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
    </svg>
  );
}
