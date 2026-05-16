/**
 * POST /api/agent-events
 *
 * Receives AgentEvent payloads from the buyer-agent process and
 * broadcasts them to all connected SSE clients.
 */
import { NextRequest, NextResponse } from "next/server";
import { broadcast } from "@/lib/sse-store";
import type { AgentEvent } from "@/lib/agent-event-types";

export async function POST(req: NextRequest) {
  try {
    const event = (await req.json()) as AgentEvent;
    if (!event.kind) {
      return NextResponse.json({ error: "missing kind" }, { status: 400 });
    }
    broadcast(event);
    return NextResponse.json({ ok: true, clients: broadcast.length });
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
