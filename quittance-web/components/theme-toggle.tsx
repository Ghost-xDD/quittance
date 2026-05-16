"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type Theme = "light" | "dark";

/**
 * Theme toggle — uses a sealed vs. unsealed diamond metaphor:
 *   Dark  → solid diamond  ("sealed / stamped" state)
 *   Light → open diamond   ("unsealed / reading" state)
 *
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const initial = (document.documentElement.dataset.theme as Theme) ?? "dark";
    setTheme(initial);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("quittance:theme", next);
    } catch {
      /* ignore */
    }
  }

  if (theme === null) {
    return (
      <button
        aria-hidden
        tabIndex={-1}
        className="num inline-flex h-[34px] w-[34px] items-center justify-center border border-seam"
      />
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className="relative inline-flex h-[34px] w-[34px] items-center justify-center overflow-hidden border border-seam text-print-faint transition-colors hover:border-print-faint hover:text-print"
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={theme}
          initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center"
          aria-hidden
        >
          {isDark ? <SealedDiamond /> : <OpenDiamond />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** Dark mode icon: solid diamond — sealed state. */
function SealedDiamond() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M6.5 1L12 6.5L6.5 12L1 6.5Z" fill="currentColor" />
    </svg>
  );
}

/** Light mode icon: diamond outline with inner check — unsealed, verified. */
function OpenDiamond() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M6.5 1L12 6.5L6.5 12L1 6.5Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 6.5l1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="square" />
    </svg>
  );
}
