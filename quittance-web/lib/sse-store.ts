/**
 * lib/sse-store.ts — shared in-process SSE client registry
 *
 * Next.js dev server (webpack, single process) lets us share state between
 * route handlers via module-level globals. The agent-events POST handler
 * calls broadcast(); the agent-stream GET handler registers its controller.
 *
 * In production (multi-instance), replace with Redis Pub/Sub.
 */

import type { AgentEvent } from "./agent-event-types";

export type { AgentEvent };

type SseController = ReadableStreamDefaultController<Uint8Array>;

const enc = new TextEncoder();

// Module-level singleton — survives hot reloads in dev
const g = globalThis as typeof globalThis & {
  __sse_clients?: Set<SseController>;
};
if (!g.__sse_clients) g.__sse_clients = new Set();
const clients = g.__sse_clients;

export function addClient(ctrl: SseController) {
  clients.add(ctrl);
}

export function removeClient(ctrl: SseController) {
  clients.delete(ctrl);
}

export function broadcast(event: AgentEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const chunk = enc.encode(data);
  for (const ctrl of clients) {
    try {
      ctrl.enqueue(chunk);
    } catch {
      clients.delete(ctrl);
    }
  }
}

export function clientCount() {
  return clients.size;
}
