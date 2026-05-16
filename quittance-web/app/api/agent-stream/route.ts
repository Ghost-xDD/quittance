/**
 * GET /api/agent-stream
 *
 * Server-Sent Events endpoint. The browser connects here and receives
 * real-time AgentEvents from the buyer-agent process (via /api/agent-events).
 */
import { addClient, removeClient } from "@/lib/sse-store";

const enc = new TextEncoder();

export async function GET() {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      addClient(ctrl);
      // Handshake event so the browser knows it's live
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ kind: "connected" })}\n\n`));
    },
    cancel() {
      removeClient(ctrl);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
