// Shared AgentEvent type — mirrors quittance-agents/lib/events.ts
// Kept in sync manually (no monorepo link needed for a hackathon).

export type AgentEventKind =
  | "user"
  | "reasoning"
  | "agent"
  | "action"
  | "quittance"
  | "error"
  | "done"
  | "connected"; // SSE handshake sent by /api/agent-stream on open

export interface QuittanceEventReceipt {
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
  actionId?: string;
  content?: string;
  actionLabel?: string;
  actionStatus?: "pending" | "confirmed" | "failed";
  txHash?: string;
  blockNumber?: number;
  userOpHash?: string;
  receipt?: QuittanceEventReceipt;
  imageUrl?: string;
  timestamp?: number;
}
