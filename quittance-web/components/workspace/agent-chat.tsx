"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ProofBadge } from "./proof-badge";
import type {
  ChatMessage,
  MessageRole,
  ProofType,
  QuittanceReceipt,
  QuittanceStatus,
  ScriptStep,
} from "./types";
import type { AgentEvent } from "@/lib/agent-event-types";

/* ─── Demo script ─────────────────────────────────────────────── */

const DEMO_SCRIPT: ScriptStep[] = [
  // ── Act 1: Happy path — sms.kite delivers, ORACLE proof settles ──
  {
    kind: "user", delay: 0,
    content: "I need to send an SMS alert to +1-555-0192 about a sudden price movement on KITE/USDC.",
  },
  {
    kind: "reasoning", delay: 600,
    content: "Querying QuittanceRegistry for registered SMS sellers on Kite testnet…",
  },
  {
    kind: "reasoning", delay: 400,
    content: "Found 6 sellers. Filtering by adapter: ORACLE (real-time delivery proof, lowest latency for time-sensitive alerts).",
  },
  {
    kind: "reasoning", delay: 500,
    content: "Ranking by reputation × success rate × bond size:\n  sms.kite     — rep 96, 97.4% success, 2.5 PYUSD bond   ← WINNER\n  sms-cheap.kite — rep 58, 71.2% success, 0.5 PYUSD bond",
  },
  {
    kind: "reasoning", delay: 400,
    content: "Preparing meta-transaction via Forwarder (EIP-712). Buyer approves Escrow directly — gasless to end user via Kite AA gasless service.",
  },
  {
    kind: "action", delay: 500,
    content: "Opening escrow with sms.kite",
    actionLabel: "Escrow.openEscrow(sms.kite, 0.001 PYUSD, ORACLE, deadline+300s)",
    txHash: "0x3f7a9c12d4e81b05",
    blockNumber: 21436812,
  },
  {
    kind: "agent", delay: 700,
    content: "Escrow opened. I've locked 0.001 PYUSD in the Quittance escrow contract with sms.kite as seller. The ORACLE adapter will verify delivery from an independent attestor — sms.kite must submit a signed delivery receipt within 300 seconds or the escrow refunds automatically.",
  },
  {
    kind: "reasoning", delay: 800,
    content: "Polling for ORACLE proof submission… sms.kite response time avg 1.2s — within SLA.",
  },
  {
    kind: "reasoning", delay: 1800,
    content: "Proof received. Attestor 0x68d9…2e44 signed delivery receipt. Verifying on-chain signature against registered attestor set…",
  },
  {
    kind: "action", delay: 300,
    content: "Settling quittance",
    actionLabel: "Escrow.settle(paymentId=0x91a347bc, proof=0x4a1f…c8e3)",
    txHash: "0xb2c4e87a9f103d56",
    blockNumber: 21436819,
  },
  {
    kind: "quittance", delay: 600,
    content: "Quittance settled.",
    receipt: {
      paymentId: "0x91a347bc",
      seller: "sms.kite",
      adapter: "ORACLE",
      amount: 0.001,
      status: "SETTLED",
      txHash: "0xb2c4e87a9f103d56",
      blockNumber: 21436819,
    },
  },
  {
    kind: "agent", delay: 400,
    content: "Done. The SMS was delivered and verified on-chain. sms.kite earned 0.001 PYUSD and their reputation score increased by +0.02. Full proof stored in QuittanceRegistry at block 21,436,819.",
  },

  // ── Act 2: Slashing — sms-cheap submits fraudulent proof ──
  {
    kind: "user", delay: 1200,
    content: "Good. Now send another alert to +1-555-0193 — use the cheapest option this time.",
  },
  {
    kind: "reasoning", delay: 500,
    content: "User requested cheapest option. Overriding reliability-first ranking.",
  },
  {
    kind: "reasoning", delay: 400,
    content: "Selected: sms-cheap.kite at 0.001 PYUSD/msg. Bronze tier — proceeding with caution. Bond posted: 0.5 PYUSD (covers 500× the trade value).",
  },
  {
    kind: "action", delay: 500,
    content: "Opening escrow with sms-cheap.kite",
    actionLabel: "Escrow.openEscrow(sms-cheap.kite, 0.001 PYUSD, ORACLE, deadline+300s)",
    txHash: "0xd91c5b3e7f820a41",
    blockNumber: 21436834,
  },
  {
    kind: "reasoning", delay: 900,
    content: "Waiting for ORACLE proof… deadline T+300s. 12 seconds elapsed.",
  },
  {
    kind: "reasoning", delay: 1200,
    content: "⚠ Proof received from sms-cheap.kite but attestor signature INVALID. Expected attestor 0x68d9…2e44, got 0x00fa…1102 — not in registered attestor set. This is a fraudulent settlement attempt.",
  },
  {
    kind: "reasoning", delay: 500,
    content: "Triggering slashing: sms-cheap.kite bond (0.5 PYUSD) will be seized. Buyer PYUSD will be refunded from escrow.",
  },
  {
    kind: "action", delay: 400,
    content: "Slashing sms-cheap.kite",
    actionLabel: "Bond.slash(seller=sms-cheap.kite, paymentId=0x7e3c9a12)",
    txHash: "0xf4a8123e9c56b701",
    blockNumber: 21436848,
  },
  {
    kind: "quittance", delay: 600,
    content: "Quittance slashed.",
    receipt: {
      paymentId: "0x7e3c9a12",
      seller: "sms-cheap.kite",
      adapter: "ORACLE",
      amount: 0.001,
      status: "SLASHED",
      txHash: "0xf4a8123e9c56b701",
      blockNumber: 21436848,
    },
  },
  {
    kind: "agent", delay: 400,
    content: "sms-cheap.kite attempted to settle with a forged attestor signature. Their 0.5 PYUSD bond has been slashed and your 0.001 PYUSD has been refunded. Their reputation score dropped to 48. I'd recommend avoiding them for future tasks.",
  },
];

/* ─── Text streaming helper ──────────────────────────────────── */

function useStreamText(target: string, speed = 9) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    if (!target) return;
    let i = 0;
    const id = setInterval(() => {
      i += Math.ceil(Math.random() * 3);
      if (i >= target.length) { setShown(target); clearInterval(id); return; }
      setShown(target.slice(0, i));
    }, speed);
    return () => clearInterval(id);
  }, [target, speed]);
  return shown;
}

/* ─── Individual message renderers ───────────────────────────── */

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-sm bg-vellum-3 px-4 py-2.5 text-[13.5px] leading-relaxed text-print">
        {msg.content}
      </div>
    </div>
  );
}

function AgentMessage({ msg, stream }: { msg: ChatMessage; stream?: boolean }) {
  const text = stream ? useStreamText(msg.content) : msg.content; // eslint-disable-line
  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div className="flex-1 pt-0.5 text-[13.5px] leading-relaxed text-print" style={{ whiteSpace: "pre-wrap" }}>
        {text}
        {stream && text !== msg.content && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-seal align-middle" />
        )}
      </div>
    </div>
  );
}

function ReasoningMessage({ msg }: { msg: ChatMessage }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex gap-3">
      <div className="flex w-6 shrink-0 justify-center">
        <div className="mt-1.5 h-full w-px bg-seam-2/60" />
      </div>
      <div
        className="flex-1 cursor-pointer rounded-sm border border-seam/40 bg-vellum-2/50 px-3 py-2"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="num text-[9px] uppercase tracking-[0.22em] text-print-ghost">
            · reasoning ·
          </span>
          <ChevronIcon collapsed={collapsed} />
        </div>
        {!collapsed && (
          <p className="mt-1.5 font-mono text-[11.5px] italic leading-relaxed text-print-faint" style={{ whiteSpace: "pre-wrap" }}>
            {msg.content}
          </p>
        )}
      </div>
    </div>
  );
}

function ActionMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-6 shrink-0 justify-center pt-2">
        <div className="h-2 w-2 rounded-full border border-seal bg-transparent" />
      </div>
      <div className="flex-1 rounded-sm border border-seam/60 bg-vellum-2/40 px-3 py-2.5">
        <div className="num flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-print-faint">
          <span>→ contract call</span>
          {msg.actionStatus === "pending" && (
            <span className="flex items-center gap-1 text-seal">
              <Spinner /> sending…
            </span>
          )}
          {msg.actionStatus === "confirmed" && (
            <span className="text-sage">✓ confirmed</span>
          )}
          {msg.actionStatus === "failed" && (
            <span className="text-crimson">✗ failed</span>
          )}
        </div>
        <p className="num mt-1.5 font-mono text-[12px] text-print-dim">
          {msg.actionLabel ?? msg.content}
        </p>
        {msg.actionStatus === "confirmed" && msg.txHash && (
          <div className="num mt-1 flex items-center gap-3 text-[10px] text-print-ghost">
            <span className="font-mono">{msg.txHash}</span>
            {msg.blockNumber && (
              <span>block <span className="text-print-faint">{msg.blockNumber.toLocaleString()}</span></span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<QuittanceStatus, string> = {
  PENDING:   "#6e655a",
  DELIVERED: "#b07e2a",
  SETTLED:   "#5e7256",
  REFUNDED:  "#6e655a",
  SLASHED:   "#9e3a22",
};

function QuittanceMessage({ msg }: { msg: ChatMessage }) {
  const receipt = msg.receipt;
  if (!receipt) return null;
  const statusColor = STATUS_COLOR[receipt.status];

  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div
        className="flex-1 rounded-sm"
        style={{
          background: "#f5efe2",
          color: "#14110d",
          border: `1px solid #d2c8b1`,
          padding: "16px 20px 18px",
          boxShadow: "0 4px 16px -6px rgba(0,0,0,0.15)",
        }}
      >
        <div
          className="num flex items-baseline justify-between border-b pb-2.5 text-[9.5px] uppercase tracking-[0.28em]"
          style={{ borderColor: "#cdb98b", color: "#6e655a" }}
        >
          <span>Proof of delivery</span>
          <span style={{ color: statusColor, fontWeight: 500 }}>{receipt.status}</span>
        </div>

        <dl className="num mt-3 space-y-1.5 text-[11px]">
          {[
            ["paymentId", receipt.paymentId],
            ["seller", receipt.seller],
            ["amount", `${receipt.amount} PYUSD`],
            ["block", receipt.blockNumber?.toLocaleString()],
            ["txHash", receipt.txHash],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k as string} className="flex items-baseline justify-between gap-4">
              <dt className="uppercase tracking-[0.22em]" style={{ color: "#8a7d62" }}>{k}</dt>
              <dd className="font-mono truncate max-w-[200px]" style={{ color: "#14110d" }}>{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 flex items-center gap-2 border-t pt-2.5" style={{ borderColor: "#cdb98b" }}>
          <ProofBadge type={receipt.adapter as ProofType} size="md" />
          <span className="num text-[9.5px] uppercase tracking-[0.22em]" style={{ color: "#6e655a" }}>
            · Kite testnet · QuittanceRegistry
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Chat input bar ─────────────────────────────────────────── */

// Live mode is the default. Set NEXT_PUBLIC_DEMO_AUTO_START=true to force the
// scripted demo on mount (useful when no buyer-agent process is running).
const DEMO_AUTO_START = process.env.NEXT_PUBLIC_DEMO_AUTO_START === "true";

interface ChatInputProps {
  onSend: (text: string) => void;
  onRunDemo: () => void;
  running: boolean;
  disabled: boolean;
  isLive: boolean;
}

function ChatInput({ onSend, onRunDemo, running, disabled, isLive }: ChatInputProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
    if (ref.current) { ref.current.style.height = "auto"; }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  function autosize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  return (
    <div className="shrink-0 border-t border-seam/60 bg-vellum/95 px-4 pb-4 pt-3 backdrop-blur-sm">
      {/* Perforation divider accent */}
      <div
        className="mb-3 h-px w-full"
        style={{
          backgroundImage: "repeating-linear-gradient(90deg, var(--seal) 0, var(--seal) 4px, transparent 4px, transparent 10px)",
          opacity: 0.3,
        }}
      />

      <div className="flex items-end gap-2.5 rounded-sm border border-seam bg-vellum-2/60 px-3 py-2.5 focus-within:border-seal/60 transition-colors">
        <textarea
          ref={ref}
          value={value}
          onChange={autosize}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder={isLive ? "Message the buyer agent…" : "Message buyer agent (or press ▶ Demo to simulate)"}
          rows={1}
          className="flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed text-print placeholder:text-print-ghost focus:outline-none"
          style={{ minHeight: "24px", maxHeight: "160px" }}
        />

        <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
          {!running && (
            <button
              type="button"
              onClick={onRunDemo}
              disabled={disabled}
              className="num flex items-center gap-1.5 border border-seal/40 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-seal/80 transition-colors hover:border-seal hover:text-seal disabled:opacity-40"
            >
              <span>▶</span>
              <span className="hidden sm:inline">Demo</span>
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || disabled}
            aria-label="Send"
            className="flex h-8 w-8 items-center justify-center border border-seam text-print-faint transition-colors hover:border-seal hover:text-seal disabled:opacity-30"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      <p className="num mt-2 text-center text-[9.5px] uppercase tracking-[0.22em] text-print-ghost">
        Quittance · Exec-Pay-Deliver · Kite testnet
      </p>
    </div>
  );
}

/* ─── SSE live stream hook ───────────────────────────────────── */

function useLiveStream(
  onEvent: (ev: AgentEvent) => void,
  onConnected: (live: boolean) => void,
) {
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/agent-stream");

    es.onopen = () => onConnected(true);
    es.onerror = () => onConnected(false);

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as AgentEvent;
        if (ev.kind === "connected") { onConnected(true); return; }
        onEvent(ev);
      } catch { /**/ }
    };

    return () => { es.close(); onConnected(false); };
  }, []); // eslint-disable-line
}

/* ─── Map AgentEvent → ChatMessage ──────────────────────────── */

function eventToMsg(ev: AgentEvent): ChatMessage | null {
  const id = mkId();
  const ts = ev.timestamp ?? Date.now();
  switch (ev.kind) {
    case "user":
      return { id, role: "user", content: ev.content ?? "", timestamp: ts };
    case "reasoning":
      return { id, role: "reasoning", content: ev.content ?? "", timestamp: ts };
    case "agent":
      return { id, role: "agent", content: ev.content ?? "", timestamp: ts };
    case "action":
      return {
        id: ev.actionId ?? id,
        role: "action",
        content: ev.content ?? "",
        timestamp: ts,
        actionStatus: ev.actionStatus,
        actionLabel: ev.actionLabel,
        txHash: ev.txHash,
        blockNumber: ev.blockNumber,
      };
    case "quittance":
      if (!ev.receipt) return null;
      return {
        id,
        role: "quittance",
        content: "",
        timestamp: ts,
        receipt: {
          paymentId:   ev.receipt.paymentId,
          seller:      ev.receipt.seller,
          adapter:     ev.receipt.adapter as ProofType,
          amount:      Number(ev.receipt.amount),
          status:      ev.receipt.status as QuittanceStatus,
          txHash:      ev.receipt.txHash,
          blockNumber: ev.receipt.blockNumber,
        },
      };
    default:
      return null;
  }
}

/* ─── Main AgentChat component ────────────────────────────────── */

function mkId() {
  return Math.random().toString(36).slice(2, 10);
}

function mkMsg(role: MessageRole, content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: mkId(), role, content, timestamp: Date.now(), ...extra };
}

const WELCOME: ChatMessage = mkMsg(
  "agent",
  "Hello. I'm your Quittance buyer agent. Every payment is atomic — you only pay when proof of delivery is on-chain.\n\nWaiting for a live session. Start the buyer agent with:\n\n  npm run buyer-agent\n\nOr press ▶ Demo for a scripted walkthrough without running the full stack.",
);

interface AgentChatProps {
  onQuittanceEvent?: (event: import("./types").QuittanceEvent) => void;
}

export function AgentChat({ onQuittanceEvent }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [running, setRunning] = useState(false);
  const [lastMsgStreaming, setLastMsgStreaming] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stoppedRef = useRef(false);

  // ── Live SSE stream from buyer-agent process ───────────────────
  const handleLiveEvent = useCallback((ev: AgentEvent) => {
    if (ev.kind === "action" && (ev.actionStatus === "confirmed" || ev.actionStatus === "failed") && ev.actionId) {
      // Update the existing pending action message
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "action" && m.id === ev.actionId
            ? { ...m, actionStatus: ev.actionStatus, txHash: ev.txHash, blockNumber: ev.blockNumber }
            : m
        )
      );
      return;
    }

    const msg = eventToMsg(ev);
    if (!msg) return;

    if (ev.kind === "user") {
      // New live session — reset chat
      setMessages([WELCOME, msg]);
    } else {
      setMessages((prev) => [...prev, msg]);
    }

    // Bubble quittance to feed panel
    if (ev.kind === "quittance" && ev.receipt && onQuittanceEvent) {
      onQuittanceEvent({
        id:        mkId(),
        paymentId: ev.receipt.paymentId,
        timestamp: Date.now(),
        seller:    ev.receipt.seller,
        adapter:   ev.receipt.adapter as ProofType,
        amount:    Number(ev.receipt.amount),
        status:    ev.receipt.status as QuittanceStatus,
        txHash:    ev.receipt.txHash,
      });
    }
  }, [onQuittanceEvent]);

  useLiveStream(handleLiveEvent, setIsLive);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }

  useEffect(() => { scrollToBottom(); }, [messages]);

  const addMsg = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const runDemoScript = useCallback(async () => {
    if (running) return;
    stoppedRef.current = false;
    setRunning(true);
    setMessages([WELCOME]);

    let cumulativeDelay = 500;

    for (const step of DEMO_SCRIPT) {
      if (stoppedRef.current) break;
      await new Promise((r) => setTimeout(r, cumulativeDelay + step.delay));
      if (stoppedRef.current) break;
      cumulativeDelay = 0;

      if (step.kind === "user") {
        addMsg(mkMsg("user", step.content!));

      } else if (step.kind === "reasoning") {
        addMsg(mkMsg("reasoning", step.content!));

      } else if (step.kind === "agent") {
        const id = mkId();
        setLastMsgStreaming(true);
        setMessages((prev) => [...prev, mkMsg("agent", step.content!, { id })]);
        await new Promise((r) => setTimeout(r, Math.ceil(step.content!.length * 9 + 400)));
        setLastMsgStreaming(false);

      } else if (step.kind === "action") {
        const id = mkId();
        setMessages((prev) => [
          ...prev,
          mkMsg("action", step.content ?? "", { id, actionStatus: "pending", actionLabel: step.actionLabel }),
        ]);
        await new Promise((r) => setTimeout(r, 1600));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, actionStatus: "confirmed", txHash: step.txHash, blockNumber: step.blockNumber }
              : m
          )
        );

      } else if (step.kind === "quittance") {
        const receipt = step.receipt!;
        addMsg(mkMsg("quittance", step.content ?? "", { receipt }));
        // Bubble up to feed
        onQuittanceEvent?.({
          id: mkId(),
          paymentId: receipt.paymentId,
          timestamp: Date.now(),
          seller: receipt.seller,
          adapter: receipt.adapter as ProofType,
          amount: receipt.amount,
          status: receipt.status as import("./types").QuittanceStatus,
          txHash: receipt.txHash,
        });
      }
    }

    setRunning(false);
  }, [running, addMsg, onQuittanceEvent]);

  // ENV-based auto-start
  useEffect(() => {
    if (DEMO_AUTO_START) {
      const t = setTimeout(runDemoScript, 1200);
      return () => clearTimeout(t);
    }
  }, []); // eslint-disable-line

  function handleUserSend(text: string) {
    addMsg(mkMsg("user", text));
    setTimeout(() => {
      addMsg(
        mkMsg("agent", "I've received your request. For live agent execution, connect this interface to the running quittance-agents process. In the meantime, you can press ▶ Demo to see a scripted walkthrough.")
      );
    }, 800);
  }

  return (
    <div className="flex h-full flex-col bg-vellum">
      {/* Title bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-seam/60 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[16px] font-light italic tracking-tight text-print">
            Buyer Agent
          </span>
          <span className="num text-[10px] uppercase tracking-[0.28em] text-print-ghost">
            · Quittance Protocol
          </span>
        </div>
        <div className="num flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-print-ghost">
          {isLive && (
            <span className="flex items-center gap-1.5 text-sage">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-50" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-sage" />
              </span>
              live
            </span>
          )}
          {running && !isLive && (
            <span className="flex items-center gap-1.5 text-seal">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-seal opacity-50" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-seal" />
              </span>
              demo running
            </span>
          )}
          <span className="hidden text-print-ghost md:inline">Exec-Pay-Deliver</span>
        </div>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="grain flex-1 overflow-y-auto px-5 py-4"
        style={{ backgroundImage: "none", background: "transparent" }}
      >
        <div className="mx-auto max-w-[760px] space-y-4">
          <AnimatePresence initial={false} mode="append">
            {messages.map((msg, i) => {
              const isLastAgent = msg.role === "agent" && i === messages.length - 1 && lastMsgStreaming;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {msg.role === "user"      && <UserMessage msg={msg} />}
                  {msg.role === "agent"     && <AgentMessage msg={msg} stream={isLastAgent} />}
                  {msg.role === "reasoning" && <ReasoningMessage msg={msg} />}
                  {msg.role === "action"    && <ActionMessage msg={msg} />}
                  {msg.role === "quittance" && <QuittanceMessage msg={msg} />}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Input bar */}
      <ChatInput
        onSend={handleUserSend}
        onRunDemo={runDemoScript}
        running={running}
        disabled={false}
        isLive={isLive}
      />
    </div>
  );
}

/* ─── Small icon components ──────────────────────────────────── */

function AgentAvatar() {
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center border border-seal/40 bg-seal/10 mt-0.5">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2" className="text-seal" />
        <circle cx="6" cy="6" r="1.5" fill="currentColor" className="text-seal" />
      </svg>
    </div>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
      className={`text-print-ghost transition-transform ${collapsed ? "-rotate-90" : ""}`}
    >
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M2 11L11 6.5 2 2v3.5l6 1-6 1V11z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="8 4" />
    </svg>
  );
}
