import { NextResponse } from "next/server";

// Kite Mainnet — Passport wallet + USDC
const RPC_URL    = process.env.RPC_URL ?? "https://rpc.gokite.ai";
const BUYER_ADDR = process.env.PASSPORT_WALLET_ADDR ?? process.env.BUYER_ADDR ?? "";
const USDC_ADDR  = process.env.USDC_ADDR ?? "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e";
const PYUSD_ADDR = process.env.PYUSD_ADDR ?? USDC_ADDR;

// balanceOf(address) selector
const BALANCE_OF = "0x70a08231";

function encode(addr: string) {
  return BALANCE_OF + addr.replace("0x", "").padStart(64, "0");
}

async function ethCall(to: string, data: string): Promise<string> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to, data }, "latest"],
  };
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const json = await res.json() as { result?: string };
  return json.result ?? "0x0";
}

async function ethBlockNumber(): Promise<number> {
  const body = { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] };
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const json = await res.json() as { result?: string };
  return parseInt(json.result ?? "0x0", 16);
}

function fromWei(hex: string, decimals = 18): string {
  const raw = BigInt(hex);
  if (raw === 0n) return "0.00";
  const divisor = 10n ** BigInt(decimals);
  const int = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${int}.${fracStr}`;
}

export async function GET() {
  if (!BUYER_ADDR) {
    return NextResponse.json({ usdc: "—", kite: "—" });
  }

  try {
    const [usdcHex, block] = await Promise.all([
      ethCall(USDC_ADDR, encode(BUYER_ADDR)),
      ethBlockNumber(),
    ]);

    // Native KITE balance via eth_getBalance
    const kiteBody = {
      jsonrpc: "2.0",
      id: 3,
      method: "eth_getBalance",
      params: [BUYER_ADDR, "latest"],
    };
    const kiteRes = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kiteBody),
      signal: AbortSignal.timeout(5000),
    });
    const kiteJson = await kiteRes.json() as { result?: string };
    const kiteBalHex = kiteJson.result ?? "0x0";

    return NextResponse.json({
      usdc: fromWei(usdcHex, 6),
      kite: fromWei(kiteBalHex, 18),
      block,
      address: BUYER_ADDR,
    });
  } catch {
    return NextResponse.json({ usdc: "—", kite: "—" });
  }
}
