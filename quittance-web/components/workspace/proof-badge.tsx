import type { ProofType } from "./types";

const BADGE: Record<ProofType, { label: string; bg: string; text: string; border: string }> = {
  ORACLE:    { label: "ORACLE",    bg: "rgba(176,126,42,0.12)",  text: "#b07e2a", border: "rgba(176,126,42,0.35)" },
  COSIGN:    { label: "COSIGN",    bg: "rgba(110,82,180,0.12)", text: "#6e52b4", border: "rgba(110,82,180,0.35)" },
  TEE:       { label: "TEE",       bg: "rgba(52,120,188,0.12)", text: "#3478bc", border: "rgba(52,120,188,0.35)" },
  ZKTLS:     { label: "ZKTLS",     bg: "rgba(60,140,128,0.12)", text: "#3c8c80", border: "rgba(60,140,128,0.35)" },
  THRESHOLD: { label: "THRESHOLD", bg: "rgba(94,114,86,0.12)",  text: "#5e7256", border: "rgba(94,114,86,0.35)" },
  TIMEOUT:   { label: "TIMEOUT",   bg: "rgba(110,101,90,0.08)", text: "#6e655a", border: "rgba(110,101,90,0.25)" },
};

interface ProofBadgeProps {
  type: ProofType;
  size?: "sm" | "md";
}

export function ProofBadge({ type, size = "sm" }: ProofBadgeProps) {
  const s = BADGE[type] ?? BADGE.ORACLE;
  const px = size === "md" ? "px-2.5 py-0.5 text-[10.5px]" : "px-2 py-px text-[9.5px]";
  return (
    <span
      className={`num inline-flex items-center border font-medium uppercase tracking-[0.2em] leading-none ${px}`}
      style={{ background: s.bg, color: s.text, borderColor: s.border }}
    >
      {s.label}
    </span>
  );
}
