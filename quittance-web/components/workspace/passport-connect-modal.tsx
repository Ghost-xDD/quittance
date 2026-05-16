"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface Policy {
  max_amount_per_tx: string;
  max_total_amount: string;
  assets: string[];
}

interface PassportConnectModalProps {
  onConnected: (sessionToken?: string) => void;
  onSkip: () => void;
}

type Step =
  | "idle"
  | "generating"
  | "awaiting-approval"
  | "polling"
  | "approved"
  | "error";

export function PassportConnectModal({ onConnected, onSkip }: PassportConnectModalProps) {
  const [step, setStep] = useState<Step>("idle");
  const [approvalUrl, setApprovalUrl] = useState("");
  const [requestId, setRequestId] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((reqId: string) => {
    stopPolling();
    setStep("polling");
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/passport-session?requestId=${reqId}`);
        const data = await res.json() as { approved?: boolean; sessionToken?: string; policy?: Policy; status?: string };
        if (data.approved) {
          stopPolling();
          setPolicy(data.policy ?? null);
          setStep("approved");
          setTimeout(() => onConnected(data.sessionToken), 1200);
        }
      } catch {
        // keep polling
      }
    }, 2500);
  }, [stopPolling, onConnected]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function handleGenerate() {
    setStep("generating");
    setErrorMsg("");
    try {
      const res = await fetch("/api/passport-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxAmountPerTx: 1,
          maxTotalAmount: 1,
          taskSummary: "Autonomous SMS delivery agent — pays via x402, verifies delivery on Kite chain via Quittance escrow",
        }),
      });
      const data = await res.json() as {
        requestId?: string;
        approvalUrl?: string;
        policy?: Policy;
        error?: string;
      };

      if (data.error || !data.approvalUrl || !data.requestId) {
        setErrorMsg(data.error ?? "Failed to create session — is kpass installed?");
        setStep("error");
        return;
      }

      setApprovalUrl(data.approvalUrl);
      setRequestId(data.requestId);
      setPolicy(data.policy ?? null);
      setStep("awaiting-approval");
      startPolling(data.requestId);
    } catch (e: any) {
      setErrorMsg(e.message ?? "Network error");
      setStep("error");
    }
  }

  function handleCopy() {
    if (!approvalUrl) return;
    navigator.clipboard.writeText(approvalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-vellum/80 backdrop-blur-md" data-passport-modal>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative mx-4 w-full max-w-md overflow-hidden border border-seam bg-vellum shadow-2xl"
      >
        {/* Header */}
        <div className="border-b border-seam/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <PassportIcon />
            <div>
              <div className="font-display text-[15px] font-light italic tracking-tight text-print">
                Connect Kite Passport
              </div>
              <div className="num mt-0.5 text-[10px] uppercase tracking-[0.22em] text-print-ghost">
                Authorize spending · USDC on Kite Mainnet
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <AnimatePresence mode="wait">
            {step === "idle" && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="mb-5 text-[13px] leading-relaxed text-print-dim">
                  This agent pays SMS providers via{" "}
                  <span className="font-mono text-seal">x402</span> — an autonomous
                  payment protocol. You&apos;ll sign a spending budget using your Kite
                  Passport passkey. Nothing is charged until a service is delivered
                  and verified on-chain.
                </p>

                <div className="mb-5 rounded-sm border border-seam/60 bg-vellum-2/60 px-4 py-3">
                  <div className="num mb-2 text-[9px] uppercase tracking-[0.22em] text-print-ghost">
                    Session budget
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-[22px] font-light text-print">1</span>
                    <span className="num text-[11px] uppercase tracking-widest text-seal">USDC</span>
                    <span className="num text-[10px] text-print-ghost">· 1 tx max · 24h TTL</span>
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  className="w-full rounded-sm bg-seal px-4 py-2.5 text-[12px] font-medium uppercase tracking-[0.18em] text-white transition hover:bg-seal/90"
                >
                  Generate Session →
                </button>
              </motion.div>
            )}

            {step === "generating" && (
              <motion.div key="gen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 py-6">
                <Spinner size={20} />
                <span className="num text-[11px] uppercase tracking-[0.2em] text-print-ghost">
                  Creating session…
                </span>
              </motion.div>
            )}

            {(step === "awaiting-approval" || step === "polling") && (
              <motion.div key="approval" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="mb-4 flex items-center gap-2">
                  {step === "polling" ? (
                    <Spinner size={12} />
                  ) : (
                    <div className="h-2 w-2 rounded-full bg-seal/60" />
                  )}
                  <span className="num text-[10px] uppercase tracking-[0.2em] text-print-ghost">
                    {step === "polling" ? "Waiting for approval…" : "Tap approve in the link below"}
                  </span>
                </div>

                {/* Approval URL */}
                <div className="mb-4 overflow-hidden rounded-sm border border-seal/30 bg-vellum-2/60">
                  <a
                    href={approvalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-4 py-3 text-[11px] text-seal underline-offset-2 hover:underline break-all font-mono"
                  >
                    {approvalUrl}
                  </a>
                  <div className="border-t border-seam/40 px-4 py-2 flex items-center justify-between">
                    <span className="num text-[9px] uppercase tracking-[0.2em] text-print-ghost">
                      Opens Kite Passport approval
                    </span>
                    <button
                      onClick={handleCopy}
                      className="num text-[9px] uppercase tracking-[0.2em] text-print-ghost hover:text-print transition"
                    >
                      {copied ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                {policy && (
                  <div className="mb-4 rounded-sm border border-seam/40 bg-vellum-2/40 px-3 py-2">
                    <div className="num flex items-center justify-between text-[10px] text-print-ghost">
                      <span>Budget</span>
                      <span className="text-seal">
                        {policy.max_amount_per_tx} {policy.assets[0]} per tx · {policy.max_total_amount} {policy.assets[0]} total
                      </span>
                    </div>
                  </div>
                )}

                <p className="text-[12px] text-print-dim leading-relaxed">
                  Approve with your Passport passkey. The session auto-activates —
                  no need to paste anything back.
                </p>
              </motion.div>
            )}

            {step === "approved" && (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-sage/40 bg-sage/10">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M4 9l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sage" />
                  </svg>
                </div>
                <div className="num text-[11px] uppercase tracking-[0.22em] text-sage">
                  Session approved
                </div>
                {policy && (
                  <div className="num text-[10px] text-print-ghost">
                    {policy.max_total_amount} {policy.assets[0]} authorized · 24h TTL
                  </div>
                )}
              </motion.div>
            )}

            {step === "error" && (
              <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="mb-4 rounded-sm border border-crimson/30 bg-crimson/5 px-4 py-3 text-[12px] text-crimson">
                  {errorMsg}
                </div>
                <button
                  onClick={() => setStep("idle")}
                  className="w-full rounded-sm border border-seam px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-print-dim hover:text-print transition"
                >
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {step !== "approved" && (
          <div className="border-t border-seam/40 px-6 py-3 flex items-center justify-between">
            <span className="text-[11px] text-print-ghost leading-relaxed">
              Need the CLI?{" "}
              <code className="rounded bg-vellum-2 px-1 py-0.5 text-[10px] text-print-dim">
                npm i -g @gokite/kpass-cli
              </code>
            </span>
            <button
              onClick={onSkip}
              className="num ml-4 shrink-0 text-[10px] uppercase tracking-[0.18em] text-print-ghost hover:text-print transition"
            >
              Skip →
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function PassportIcon() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-seal/40 bg-seal/10">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.1" className="text-seal" />
        <circle cx="7" cy="5.5" r="1.8" stroke="currentColor" strokeWidth="1.1" className="text-seal" />
        <path d="M3.5 10.5c0-1.93 1.57-3.5 3.5-3.5s3.5 1.57 3.5 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" className="text-seal" />
      </svg>
    </div>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin text-seal"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" strokeDasharray="12 8" />
    </svg>
  );
}
