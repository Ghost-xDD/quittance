/**
 * lib/events.ts — AgentEvent types + HTTP broadcaster
 *
 * Every on-chain action and reasoning step emits a structured AgentEvent.
 * The emitter POSTs events to the web UI's webhook (non-blocking fire-and-forget)
 * and always logs to stdout — so the script is useful even without the web UI running.
 */

export type AgentEventKind =
  | "user"       // task the buyer was given
  | "reasoning"  // agent decision trace
  | "agent"      // agent narrative message
  | "action"     // on-chain UserOp (pending → confirmed)
  | "quittance"  // final settlement receipt
  | "error"
  | "done";

export interface QuittanceReceipt {
  paymentId: string;
  seller: string;
  adapter: string;
  amount: string;
  status: "SETTLED" | "SLASHED" | "REFUNDED";
  txHash?: string;
  blockNumber?: number;
}

export interface AgentEvent {
  kind: AgentEventKind;
  actionId?: string;      // stable key used to update pending → confirmed
  content?: string;
  actionLabel?: string;
  actionStatus?: "pending" | "confirmed" | "failed";
  txHash?: string;
  blockNumber?: number;
  userOpHash?: string;
  receipt?: QuittanceReceipt;
  timestamp?: number;
}

// ─── Colour helpers for stdout ─────────────────────────────────────────────────

const C = {
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  amber:  "\x1b[33m",
  cyan:   "\x1b[36m",
  red:    "\x1b[31m",
  italic: "\x1b[3m",
  reset:  "\x1b[0m",
} as const;

function ts() { return new Date().toISOString().slice(11, 23); }

function logEvent(ev: AgentEvent) {
  const pre = `${C.dim}[${ts()}]${C.reset}`;
  switch (ev.kind) {
    case "user":
      console.log(`${pre} ${C.amber}[user     ]${C.reset} ${ev.content}`);
      break;
    case "reasoning":
      console.log(`${pre} ${C.dim}[reasoning]${C.italic} ${ev.content}${C.reset}`);
      break;
    case "agent":
      console.log(`${pre} ${C.cyan}[agent    ]${C.reset} ${ev.content}`);
      break;
    case "action":
      if (ev.actionStatus === "pending") {
        console.log(`${pre} ${C.amber}[action   ]${C.reset} → ${ev.actionLabel} …`);
      } else if (ev.actionStatus === "confirmed") {
        console.log(`${pre} ${C.green}[action   ]${C.reset} ✓ ${ev.actionLabel}  tx ${ev.txHash}  block ${ev.blockNumber}`);
      } else {
        console.log(`${pre} ${C.red}[action   ]${C.reset} ✗ ${ev.actionLabel}`);
      }
      break;
    case "quittance":
      const r = ev.receipt!;
      console.log(`${pre} ${C.green}[quittance]${C.reset} ${r.status}  ${r.seller}  ${r.amount} PYUSD  tx ${r.txHash}`);
      break;
    case "error":
      console.error(`${pre} ${C.red}[error    ]${C.reset} ${ev.content}`);
      break;
    case "done":
      console.log(`${pre} ${C.green}[done     ]${C.reset} cycle complete`);
      break;
  }
}

// ─── Emitter ──────────────────────────────────────────────────────────────────

const WEBHOOK = process.env.EVENTS_WEBHOOK_URL ?? "http://localhost:3001/api/agent-events";

export async function emit(event: AgentEvent): Promise<void> {
  const payload: AgentEvent = { ...event, timestamp: Date.now() };
  logEvent(payload);
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // web UI not running — script continues normally
  }
}

/** Convenience: emit action pending, run fn, emit confirmed or failed. */
export async function emitAction<T>(
  actionId: string,
  actionLabel: string,
  fn: () => Promise<T>,
): Promise<T> {
  await emit({ kind: "action", actionId, actionLabel, actionStatus: "pending" });
  try {
    const result = await fn();
    return result;
  } catch (err) {
    await emit({ kind: "action", actionId, actionLabel, actionStatus: "failed", content: String(err) });
    throw err;
  }
}
