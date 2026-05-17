/**
 * POST /api/run-task
 *
 * Spawns the buyer-agent process with a user-provided task.
 * The agent emits structured AgentEvents back to /api/agent-events
 * (webhook), which broadcasts them to all SSE clients.
 *
 * Body: { task: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

// Resolve quittance-agents directory relative to the Next.js project root
const AGENTS_DIR = path.resolve(process.cwd(), "..", "quittance-agents");

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

  // Derive the webhook URL from the incoming request so it works on any port/host.
  const origin = req.nextUrl.origin; // e.g. http://localhost:3000
  const webhookUrl = `${origin}/api/agent-events`;

  const extraEnv: Record<string, string> = {
    FORCE_COLOR: "0",
    EVENTS_WEBHOOK_URL: webhookUrl,
  };
  if (sessionToken) {
    extraEnv.KPASS_SESSION_TOKEN = sessionToken;
  }

  // Fire-and-forget: buyer-agent streams events back via /api/agent-events webhook
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
