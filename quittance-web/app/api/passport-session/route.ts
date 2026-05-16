/**
 * Kite Passport session management
 *
 * POST /api/passport-session  — create a new spending session
 * GET  /api/passport-session?requestId=...  — poll approval status
 */
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface KpassSessionCreate {
  status: string;
  approval_url?: string;
  request_id?: string;
  delegation?: {
    payment_policy: {
      max_amount_per_tx: string;
      max_total_amount: string;
      assets: string[];
    };
  };
  error?: string;
}

interface KpassSessionStatus {
  status: string;
  session_token?: string;
  error?: string;
  delegation?: {
    payment_policy: {
      max_amount_per_tx: string;
      max_total_amount: string;
      assets: string[];
    };
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    maxAmountPerTx?: number;
    maxTotalAmount?: number;
    taskSummary?: string;
  };

  const maxPerTx = body.maxAmountPerTx ?? 1;
  const maxTotal = body.maxTotalAmount ?? 1;
  const summary = body.taskSummary ?? "Autonomous SMS delivery agent — pays via x402, verifies delivery on Kite chain via Quittance escrow";

  const cmd = [
    "kpass agent:session create",
    `--task-summary ${JSON.stringify(summary)}`,
    `--max-amount-per-tx ${maxPerTx}`,
    `--max-total-amount ${maxTotal}`,
    "--ttl 24h",
    "--assets USDC",
    "--output json",
  ].join(" ");

  try {
    const { stdout } = await execAsync(cmd, { timeout: 20_000 });
    const data = JSON.parse(stdout) as KpassSessionCreate;

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    return NextResponse.json({
      requestId: data.request_id,
      approvalUrl: data.approval_url,
      status: data.status,
      policy: data.delegation?.payment_policy,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "kpass error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  const cmd = `kpass agent:session status --request-id ${requestId} --output json`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 15_000 });
    const data = JSON.parse(stdout) as KpassSessionStatus;

    const approved = data.status === "approved" || data.status === "active";

    return NextResponse.json({
      status: data.status,
      approved,
      sessionToken: data.session_token,
      policy: data.delegation?.payment_policy,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "kpass error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
