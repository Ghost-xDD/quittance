"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";

/**
 * Scanner crosshair — two hairline rules extend from the cursor position,
 * intersecting at a small marigold diamond. Feels like a document scanner
 * or a registry entry cursor, not a ambient light blob.
 *
 */
export function CursorGlow() {
  const [enabled, setEnabled] = useState(false);
  const rawX = useMotionValue(-2000);
  const rawY = useMotionValue(-2000);
  const x = useSpring(rawX, { stiffness: 160, damping: 22, mass: 0.3 });
  const y = useSpring(rawY, { stiffness: 160, damping: 22, mass: 0.3 });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isFine = window.matchMedia("(pointer: fine)").matches;
    if (reduce || !isFine) return;
    setEnabled(true);
    const onMove = (e: MouseEvent) => {
      rawX.set(e.clientX);
      rawY.set(e.clientY);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [rawX, rawY]);

  if (!enabled) return null;

 
  const hRule =
    "linear-gradient(90deg, transparent 0%, rgba(var(--glow-color-r),var(--glow-color-g),var(--glow-color-b),0.07) 12%, rgba(var(--glow-color-r),var(--glow-color-g),var(--glow-color-b),0.16) 50%, rgba(var(--glow-color-r),var(--glow-color-g),var(--glow-color-b),0.07) 88%, transparent 100%)";
  const vRule =
    "linear-gradient(180deg, transparent 0%, rgba(var(--glow-color-r),var(--glow-color-g),var(--glow-color-b),0.07) 12%, rgba(var(--glow-color-r),var(--glow-color-g),var(--glow-color-b),0.16) 50%, rgba(var(--glow-color-r),var(--glow-color-g),var(--glow-color-b),0.07) 88%, transparent 100%)";

  return (
    <>
      {/* Horizontal hairline */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 right-0 z-[1] h-px"
        style={{ top: y, background: hRule }}
      />

      {/* Vertical hairline */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed top-0 bottom-0 z-[1] w-px"
        style={{ left: x, background: vRule }}
      />

      {/* Diamond intersection — matches the logo mark */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed z-[2] h-[7px] w-[7px]"
        style={{
          left: x,
          top: y,
          translateX: "-50%",
          translateY: "-50%",
          rotate: 45,
          background: "var(--seal)",
          opacity: 0.5,
        }}
      />
    </>
  );
}
