"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ProofBadge } from "./proof-badge";
import type {
  ChatMessage,
  MessageRole,
  ProofType,
  QuittanceStatus,
  ScriptStep,
} from "./types";
import type { AgentEvent } from "@/lib/agent-event-types";
import { PassportConnectModal } from "./passport-connect-modal";

/* ─── Demo script ─────────────────────────────────────────────── */

const DEMO_SCRIPT: ScriptStep[] = [
  // ── Act 0: Passport session approval ──
  {
    kind: "passport", delay: 0,
    content: "Connect Kite Passport to authorize a spending session.",
  },

  // ── Act 1: Stakes — cheap seller fails, pro seller delivers ──
  {
    kind: "user", delay: 0,
    content: "Send an order confirmation email to demo@example.com.",
  },
  {
    kind: "reasoning", delay: 600,
    content: "→ list_sellers()",
  },
  {
    kind: "reasoning", delay: 800,
    content: "Two email sellers found:\n  email.kite       — Gold, 100% success, 1.0 USDC bond\n  email-cheap.kite — Bronze, no track record, 1.0 USDC bond\n\nProtocol protects me on failure — trying cheapest first.",
  },
  {
    kind: "reasoning", delay: 400,
    content: "→ quittance_pay(sellerName=\"email-cheap.kite\", to=\"demo@example.com\", subject=\"Order Confirmation\", ...)",
  },
  {
    kind: "reasoning", delay: 300,
    content: "x402 Round 1 — requesting from email-cheap.kite…",
  },
  {
    kind: "action", delay: 400,
    content: "402 negotiation",
    actionLabel: "POST /task → 402 received — paymentId 0xd8c749…  amount 0.001 USDC → escrow 0x72D11a…",
  },
  {
    kind: "reasoning", delay: 300,
    content: "x402 Round 2 — sending X-PAYMENT…\n  Seller will: openEscrow → deliver → QuittanceRegistry.post()",
  },
  {
    kind: "action", delay: 600,
    content: "Escrow opened by cheap seller",
    actionLabel: "202 Accepted — cheap seller opened escrow but skipped delivery",
  },
  {
    kind: "reasoning", delay: 300,
    content: "Cheap seller took the escrow but didn't deliver. Refund + bond slash scheduled automatically. Routing to reliable seller next.",
  },
  {
    kind: "reasoning", delay: 200,
    content: "→ quittance_pay(sellerName=\"email.kite\", to=\"demo@example.com\", subject=\"Order Confirmation\", ...)",
  },
  {
    kind: "action", delay: 400,
    content: "402 negotiation",
    actionLabel: "POST /task → 402 received — paymentId 0xaf3920…  amount 0.001 USDC → escrow 0x72D11a…",
  },
  {
    kind: "action", delay: 1800,
    content: "Escrow + quittance",
    actionLabel: "Escrow opened + Quittance posted → block 87379",
    txHash: "0xbe7e41c6d9323f5459eae55f2ad723f2655590977531c76dedcadbb9d3ff5dcf",
    blockNumber: 87379,
  },
  {
    kind: "quittance", delay: 400,
    content: "",
    receipt: {
      paymentId: "0xaf39206801212388",
      seller: "email.kite",
      adapter: "ORACLE",
      amount: 0.001,
      status: "SETTLED",
      txHash: "0xbe7e41c6d9323f5459eae55f2ad723f2655590977531c76dedcadbb9d3ff5dcf",
      blockNumber: 87379,
    },
  },
  {
    kind: "agent", delay: 400,
    content: "First I tried email-cheap.kite — they opened escrow but didn't deliver. Refund + bond slash scheduled automatically.\n\nRouted to email.kite. Email delivered. Quittance posted on Kite mainnet at block 87,379.",
  },

  // ── Act 2: Composability — image generation ──
  {
    kind: "user", delay: 1200,
    content: "Generate a product banner image — futuristic city at sunset.",
  },
  {
    kind: "reasoning", delay: 500,
    content: "→ quittance_pay(sellerName=\"image.kite\", prompt=\"futuristic city at sunset\")",
  },
  {
    kind: "reasoning", delay: 300,
    content: "Different service category — routing to image.kite. Same Quittance protocol, different deliverable.",
  },
  {
    kind: "action", delay: 400,
    content: "402 negotiation",
    actionLabel: "POST /task → 402 received — paymentId 0x59800b…  amount 0.001 USDC → escrow 0x72D11a…",
  },
  {
    kind: "action", delay: 1800,
    content: "Escrow + quittance",
    actionLabel: "Escrow opened + Quittance posted → block 87366",
    txHash: "0x37c98e22efe9354dd3fdd91d073ca9457de8cfd23ea8c0309491c212269b1ed3",
    blockNumber: 87366,
  },
  {
    kind: "quittance", delay: 400,
    content: "",
    receipt: {
      paymentId: "0x59800b6478c35410",
      seller: "image.kite",
      adapter: "ORACLE",
      amount: 0.001,
      status: "SETTLED",
      txHash: "0x37c98e22efe9354dd3fdd91d073ca9457de8cfd23ea8c0309491c212269b1ed3",
      blockNumber: 87366,
    },
  },
  {
    kind: "agent", delay: 400,
    content: "Image generated and delivered. Oracle proof of keccak256(imageUrl) posted to QuittanceRegistry at block 87,366. Escrow released 0.001 USDC to image.kite.\n\nEmail, image — same protocol. Any x402 service gets delivery guarantees in five lines of code.",
  },
];

/* ─── Text streaming helper ──────────────────────────────────── */

function useStreamText(target: string, speed = 9) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setShown("");
      if (!target) return;
      let i = 0;
      intervalId = setInterval(() => {
        i += Math.ceil(Math.random() * 3);
        if (i >= target.length) {
          setShown(target);
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
          return;
        }
        setShown(target.slice(0, i));
      }, speed);
    });
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
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
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    let i = 0;
    const full = msg.content;
    const id = setInterval(() => {
      i += 2; // ~2 chars per tick → comfortable reading pace
      setDisplayed(full.slice(0, i));
      if (i >= full.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [msg.content]);

  const streaming = displayed.length < msg.content.length;

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
          {!streaming && <ChevronIcon collapsed={collapsed} />}
          {streaming && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-seal/60" />}
        </div>
        {!collapsed && (
          <p className="mt-1.5 font-mono text-[11.5px] italic leading-relaxed text-print-faint" style={{ whiteSpace: "pre-wrap" }}>
            {displayed}
            {streaming && <span className="animate-pulse opacity-60">▋</span>}
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

        {receipt.imageUrl && (
          <div className="mt-3 overflow-hidden rounded-sm border" style={{ borderColor: "#cdb98b" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receipt.imageUrl}
              alt="Generated image"
              className="w-full object-cover"
              style={{ maxHeight: "260px" }}
            />
          </div>
        )}

        <dl className="num mt-3 space-y-1.5 text-[11px]">
          {[
            ["paymentId", receipt.paymentId],
            ["seller", receipt.seller],
            ["amount", `${receipt.amount} USDC`],
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
          <a
            href={receipt.txHash ? `https://kitescan.ai/tx/${receipt.txHash}` : "https://kitescan.ai"}
            target="_blank"
            rel="noopener noreferrer"
            className="num text-[9.5px] uppercase tracking-[0.22em] underline-offset-2 hover:underline"
            style={{ color: "#6e655a" }}
          >
            · Kite mainnet · QuittanceRegistry ↗
          </a>
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
  disabled: boolean;
}

function ChatInput({ onSend, disabled }: ChatInputProps) {
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

      <div className="flex items-end gap-2.5 rounded-sm border border-seam bg-vellum-2/60 px-3 py-2.5 transition-colors focus-within:border-seal/60">
        <textarea
          ref={ref}
          value={value}
          onChange={autosize}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder="Message the buyer agent…"
          rows={1}
          className="agent-chat-composer-input flex-1 resize-none border-0 bg-transparent text-[13.5px] leading-relaxed text-print shadow-none outline-none ring-0 placeholder:text-print-ghost"
          style={{ minHeight: "24px", maxHeight: "160px" }}
        />

        <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || disabled}
            aria-label="Send"
            className="flex h-8 w-8 items-center justify-center border border-seam text-print-faint transition-colors hover:border-seal hover:text-seal focus-visible:outline-none disabled:opacity-30"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      <p className="num mt-2 text-center text-[9.5px] uppercase tracking-[0.22em] text-print-ghost">
        Quittance · Exec-Pay-Deliver · Kite mainnet
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
          imageUrl:    ev.imageUrl,
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
  "I'm a buyer agent running on Kite. Tell me what you need — I'll source a provider, negotiate terms, and handle payment automatically.\n\nI don't trust sellers on their word. Every job is backed by an on-chain escrow: the provider puts up a bond, I lock your payment, and funds only move when cryptographic proof of delivery hits the chain. If they fail to deliver, you get your money back and their bond is slashable.\n\nWhat's the task?",
);

interface AgentChatProps {
  onQuittanceEvent?: (event: import("./types").QuittanceEvent) => void;
}

export function AgentChat({ onQuittanceEvent }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [running, setRunning] = useState(false);
  const [lastMsgStreaming, setLastMsgStreaming] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [passportConnected, setPassportConnected] = useState(false);
  const [passportSessionToken, setPassportSessionToken] = useState<string | undefined>();
  // Show the passport modal immediately on mount in live mode — avoids a
  // brief flash of the workspace before the SSE handshake triggers it.
  const [showPassportModal, setShowPassportModal] = useState(!DEMO_AUTO_START);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stoppedRef = useRef(false);
  const passportConnectedRef = useRef(passportConnected);
  useEffect(() => { passportConnectedRef.current = passportConnected; }, [passportConnected]);
  // Tracks the earliest time the next live reasoning message should appear,
  // so rapid-fire events stagger naturally instead of landing all at once.
  const nextReasoningAt = useRef(0);

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
      // New live session — reset chat (dedupe if the UI already added the
      // user message optimistically via handleUserSend).
      nextReasoningAt.current = 0;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const alreadyShown = last?.role === "user" && last.content === (ev.content ?? "");
        return alreadyShown ? prev : [WELCOME, msg];
      });
    } else if (ev.kind === "reasoning") {
      // Stagger: each reasoning message waits until the previous one has had
      // time to finish typing (~16ms/2chars) plus a 120ms visual gap.
      const charDelay = Math.ceil((ev.content?.length ?? 0) / 2) * 16;
      const gap = 120;
      const now = Date.now();
      const scheduleAt = Math.max(now, nextReasoningAt.current);
      nextReasoningAt.current = scheduleAt + charDelay + gap;
      const wait = scheduleAt - now;
      if (wait <= 0) {
        setMessages((prev) => [...prev, msg]);
      } else {
        setTimeout(() => setMessages((prev) => [...prev, msg]), wait);
      }
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

  useLiveStream(handleLiveEvent, (live: boolean) => {
    setIsLive(live);
  });

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

      if (step.kind === "passport") {
        // Show the passport modal as part of the demo flow
        setShowPassportModal(true);
        // Wait for it to be dismissed (connected or skipped) before continuing
        await new Promise<void>((resolve) => {
          const unsub = setInterval(() => {
            if (!document.querySelector("[data-passport-modal]")) {
              clearInterval(unsub);
              resolve();
            }
          }, 300);
        });

      } else if (step.kind === "user") {
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

  async function handleUserSend(text: string) {
    // If live and no passport session, prompt connection first
    if (isLive && !passportConnected) {
      setShowPassportModal(true);
      return;
    }
    addMsg(mkMsg("user", text));
    try {
      const res = await fetch("/api/run-task", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ task: text, sessionToken: passportSessionToken }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        addMsg(mkMsg("agent", `Could not start agent: ${err.error ?? res.statusText}`));
      }
      // On success the agent emits events back through the SSE stream.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      addMsg(mkMsg("agent", `Network error reaching /api/run-task: ${msg}`));
    }
  }

  return (
    <>
      {showPassportModal && (
        <PassportConnectModal
          onConnected={(token) => {
            setPassportSessionToken(token);
            setPassportConnected(true);
            setShowPassportModal(false);
            addMsg(mkMsg("agent", "Kite Passport session authorized. Budget: 1 USDC · 24h TTL. I can now execute x402 payments on your behalf — every cent is only released when delivery is cryptographically verified on Kite chain. What do you need?"));
          }}
          onSkip={() => {
            setPassportConnected(true);
            setShowPassportModal(false);
            addMsg(mkMsg("agent", "Passport skipped — running with pre-funded session. What's the task?"));
          }}
        />
      )}

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
          {isLive && passportConnected && (
            <span className="flex items-center gap-1.5 text-sage">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-50" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-sage" />
              </span>
              passport · live
            </span>
          )}
          {isLive && !passportConnected && (
            <button
              onClick={() => setShowPassportModal(true)}
              className="flex items-center gap-1.5 rounded-sm border border-seal/40 bg-seal/10 px-2.5 py-1 text-seal transition hover:bg-seal/20"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-seal opacity-50" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-seal" />
              </span>
              Connect Passport
            </button>
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
          <AnimatePresence initial={false} mode="sync">
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
      <ChatInput onSend={handleUserSend} disabled={running} />
    </div>
    </>
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
