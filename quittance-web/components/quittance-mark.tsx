"use client";

import { motion } from "motion/react";

/**
 * The Quittance mark: a rotated-square (diamond) frame with a delivery
 * checkmark inside — the diamond evokes a stamp / seal impression, and
 * the check represents verified proof-of-delivery.
 *
 * On hover the diamond rotates 90° into a square, then back — a small
 * physical "seal being pressed" gesture.
 */
export function QuittanceMark({
  size = 22,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden
      className={className}
      whileHover={{ rotate: 45, scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 340, damping: 22 }}
    >
      {/* Outer diamond — the seal impression */}
      <path
        d="M11 1.2L20.8 11L11 20.8L1.2 11Z"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
      {/* Marigold fill — activated by the stamp */}
      <path
        d="M11 4.8L17.2 11L11 17.2L4.8 11Z"
        fill="var(--seal)"
        opacity="0.22"
      />
      {/* Delivery check — the proof */}
      <path
        d="M7.8 11.2L10.1 13.5L14.6 8.6"
        stroke="var(--seal)"
        strokeWidth="1.5"
        strokeLinecap="square"
        fill="none"
      />
    </motion.svg>
  );
}
