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
  status: string;          // "success" | "pending" | "error"
  session_id?: string;     // set when approved
  session?: {
    id: string;
    status: string;        // "active"
    expires_at?: string;
    delegation?: {
      payment_policy?: {
        max_amount_per_tx: string;
        max_total_amount: string;
        assets: string[];
      };
    };
    usage?: { spent_total: string; reserved_total: string };
  };
  session_token?: string;  // some versions return this directly
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
  const summary = body.taskSummary ?? "Quittance buyer agent — email and image delivery via x402 on Kite Mainnet";

  const delegation = JSON.stringify({
    task: { summary },
    payment_policy: {
      allowed_payment_approaches: ["x402"],
      assets: ["USDC"],
      max_amount_per_tx: String(maxPerTx),
      max_total_amount: String(maxTotal),
      ttl_seconds: 86400,
    },
  });

  const cmd = `kpass agent:session create --delegation ${JSON.stringify(delegation)} --output json`;

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

    // kpass returns status:"success" when approved (session.status === "active")
    const approved =
      data.status === "success" ||
      data.status === "approved" ||
      data.session?.status === "active";

    // session token: prefer session_token field, fall back to session.id
    const sessionToken = data.session_token ?? data.session_id ?? data.session?.id;

    const policy =
      data.session?.delegation?.payment_policy ??
      data.delegation?.payment_policy;

    return NextResponse.json({
      status: data.status,
      approved,
      sessionToken,
      policy,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "kpass error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
