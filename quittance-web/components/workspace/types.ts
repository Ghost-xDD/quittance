export type ProofType = "ORACLE" | "COSIGN" | "TEE" | "ZKTLS" | "THRESHOLD" | "TIMEOUT";
export type QuittanceStatus = "PENDING" | "DELIVERED" | "SETTLED" | "REFUNDED" | "SLASHED";
export type SellerTier = "gold" | "silver" | "bronze";

export interface Seller {
  id: string;
  name: string;
  adapter: ProofType;
  tier: SellerTier;
  bond: number;
  successRate: number;
  completed: number;
  avgLatencyMs: number;
  reputation: number;
}

export interface QuittanceEvent {
  id: string;
  paymentId: string;
  timestamp: number;
  seller: string;
  adapter: ProofType;
  amount: number;
  status: QuittanceStatus;
  txHash?: string;
}

export type ActionStatus = "pending" | "confirmed" | "failed";

export interface QuittanceReceipt {
  paymentId: string;
  seller: string;
  adapter: ProofType;
  amount: number;
  status: QuittanceStatus;
  txHash?: string;
  blockNumber?: number;
}

// Chat message types
export type MessageRole = "user" | "agent" | "reasoning" | "action" | "quittance";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  // reasoning-specific
  collapsed?: boolean;
  // action-specific
  actionStatus?: ActionStatus;
  actionLabel?: string;
  txHash?: string;
  blockNumber?: number;
  // quittance-specific
  receipt?: QuittanceReceipt;
}

// Demo script step
export type ScriptStepKind = "user" | "reasoning" | "agent" | "action" | "quittance" | "passport";

export interface ScriptStep {
  kind: ScriptStepKind;
  delay: number;
  content?: string;
  // action
  actionLabel?: string;
  txHash?: string;
  blockNumber?: number;
  // quittance
  receipt?: QuittanceReceipt;
}
