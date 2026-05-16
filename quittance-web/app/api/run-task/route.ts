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
  try {
    const body = await req.json();
    task = (body.task ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!task) {
    return NextResponse.json({ error: "task is required" }, { status: 400 });
  }

  // Fire-and-forget: buyer-agent streams events back via /api/agent-events webhook
  const proc = spawn(
    "npx",
    ["tsx", "scripts/buyer-agent.ts", "--task", task],
    {
      cwd:      AGENTS_DIR,
      // Pass the current process env so OPENAI_API_KEY etc. inherited by
      // the sub-process alongside the .env the agent loads itself.
      env:     { ...process.env, FORCE_COLOR: "0" },
      stdio:   "ignore",
      detached: true,
    },
  );
  proc.unref(); // don't keep the Next.js server alive waiting for this

  return NextResponse.json({ ok: true, task });
}
