/**
 * POST /api/run-task
 *
 * Triggers the buyer-agent with a user-provided task.
 *
 * Production (Vercel): forwards the request to BUYER_AGENT_URL (Railway service)
 *   via HTTP — the remote server spawns the agent and streams AgentEvents back
 *   to EVENTS_WEBHOOK_URL.
 *
 * Local dev: spawns buyer-agent.ts directly as a child process (original behaviour).
 *
 * Body: { task: string, sessionToken?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

const AGENTS_DIR    = path.resolve(process.cwd(), "..", "quittance-agents");
const BUYER_AGENT_URL = process.env.BUYER_AGENT_URL; // e.g. https://buyer-agent.railway.app

export async function POST(req: NextRequest) {
  let task = "";
  let sessionToken: string | undefined;
  try {
    const body = await req.json();
    task = (body.task ?? "").trim();
    sessionToken = body.sessionToken as string | undefined;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!task) {
    return NextResponse.json({ error: "task is required" }, { status: 400 });
  }

  const origin      = req.nextUrl.origin;
  const webhookUrl  = `${origin}/api/agent-events`;

  // ── Production: delegate to Railway buyer-agent service ────────
  if (BUYER_AGENT_URL) {
    try {
      const res = await fetch(`${BUYER_AGENT_URL}/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          task,
          eventsWebhookUrl: webhookUrl,
          // Pass session token if the user provided one; otherwise the
          // Railway service uses its own KPASS_SESSION_TOKEN env var.
          ...(sessionToken && { sessionToken }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return NextResponse.json({ error: (err as { error?: string }).error ?? res.statusText }, { status: 502 });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "buyer-agent service unreachable";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    return NextResponse.json({ ok: true, task });
  }

  // ── Local dev: spawn buyer-agent process directly ──────────────
  const extraEnv: Record<string, string> = {
    FORCE_COLOR: "0",
    EVENTS_WEBHOOK_URL: webhookUrl,
  };
  if (sessionToken) {
    extraEnv.KPASS_SESSION_TOKEN = sessionToken;
  }

  const proc = spawn(
    "npx",
    ["tsx", "scripts/buyer-agent.ts", "--task", task],
    {
      cwd:      AGENTS_DIR,
      env:     { ...process.env, ...extraEnv },
      stdio:   "ignore",
      detached: true,
    },
  );
  proc.unref();

  return NextResponse.json({ ok: true, task });
}
