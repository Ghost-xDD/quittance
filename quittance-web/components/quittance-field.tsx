"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * QuittanceField — the background IS the protocol.
 *
 *
 */

type Phase = "normal" | "slashed";

type ActiveCell = {
  key: number;
  col: number;
  row: number;
  phase: Phase;
  duration: number;
};

const CELL = 88;

export function QuittanceField({
  spawnEvery = 900,
  maxCells = 10,
}: {
  spawnEvery?: number;
  maxCells?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.ceil(size.w / CELL));
  const rows = Math.max(1, Math.ceil(size.h / CELL));
  const total = cols * rows;

  const [cells, setCells] = useState<ActiveCell[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    if (total === 0) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!alive) return;
      const idx = Math.floor(Math.random() * total);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const isSlashed = Math.random() < 0.07;
      const duration = isSlashed
        ? 1.4 + Math.random() * 0.6
        : 4.8 + Math.random() * 2.4;

      const cell: ActiveCell = {
        key: counter.current++,
        col,
        row,
        phase: isSlashed ? "slashed" : "normal",
        duration,
      };

      setCells((prev) => {
        const next = [...prev, cell];
        return next.length > maxCells ? next.slice(-maxCells) : next;
      });
    }, spawnEvery);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [total, cols, spawnEvery, maxCells]);

  // Cull cells that have finished their animation — estimate by duration.
  useEffect(() => {
    if (cells.length === 0) return;
    const oldest = cells[0];
    const id = setTimeout(
      () => setCells((prev) => prev.filter((c) => c.key !== oldest.key)),
      oldest.duration * 1000 + 200,
    );
    return () => clearTimeout(id);
  }, [cells]);

  const rendered = useMemo(
    () =>
      cells.map((c) => (
        <span
          key={c.key}
          aria-hidden
          style={{
            position: "absolute",
            left: c.col * CELL,
            top: c.row * CELL,
            width: CELL,
            height: CELL,
            borderRadius: 3,
            opacity: 0,
            animationName: c.phase === "slashed" ? "qcell-slashed" : "qcell-normal",
            animationDuration: `${c.duration}s`,
            animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
            animationFillMode: "forwards",
          }}
        />
      )),
    [cells],
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {rendered}

      {/* Fade-to-ink vignette so the hero text remains readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 70% at 50% 40%, transparent 10%, var(--vellum) 72%)",
        }}
      />
    </div>
  );
}
