/**
 * buyer-server.ts — HTTP wrapper around the buyer agent for Railway deployment.
 *
 * POST /run   { task: string, eventsWebhookUrl?: string, sessionToken?: string }
 *   → 202 Accepted immediately; buyer-agent runs in background and streams
 *     AgentEvents to eventsWebhookUrl (or EVENTS_WEBHOOK_URL env var).
 *
 * GET  /health  → 200 { ok: true }
 *
 * Set BUYER_AGENT_URL=https://<this-service>.railway.app in Vercel so that
 * run-task/route.ts calls this service instead of spawning locally.
 */
import "dotenv/config";
import http from "http";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const PORT = parseInt(process.env.PORT ?? "4010");
const AGENTS_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end",  () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // ── Health check ───────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── CORS preflight ─────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // ── POST /run ──────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/run") {
    let body: { task?: string; eventsWebhookUrl?: string; sessionToken?: string } = {};
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const task = (body.task ?? "").trim();
    if (!task) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "task is required" }));
      return;
    }

    const webhookUrl = body.eventsWebhookUrl ?? process.env.EVENTS_WEBHOOK_URL ?? "";
    const sessionToken = body.sessionToken ?? process.env.KPASS_SESSION_TOKEN ?? "";

    const extraEnv: Record<string, string> = {
      FORCE_COLOR: "0",
      ...(webhookUrl  && { EVENTS_WEBHOOK_URL:  webhookUrl }),
      ...(sessionToken && { KPASS_SESSION_TOKEN: sessionToken }),
    };

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

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, task }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Quittance buyer-server listening on port ${PORT}`);
});
