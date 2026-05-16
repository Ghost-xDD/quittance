"use client";

import { useEffect, useState } from "react";

const BUYER_ADDR = process.env.NEXT_PUBLIC_BUYER_ADDR ?? "0xBuyerWallet";
const RPC_URL    = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc-testnet.gokite.ai";

function truncate(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Balances { pyusd: string; kite: string }

export function WalletStrip() {
  const [balances, setBalances] = useState<Balances>({ pyusd: "—", kite: "—" });
  const [online, setOnline] = useState(true);
  const [block, setBlock] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBalances() {
      try {
        const res = await fetch("/api/wallet");
        if (!res.ok) throw new Error("not ok");
        const data = await res.json() as Balances & { block?: number };
        if (!cancelled) {
          setBalances({ pyusd: data.pyusd, kite: data.kite });
          if (data.block) setBlock(data.block);
          setOnline(true);
        }
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    fetchBalances();
    const id = setInterval(fetchBalances, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="num flex h-10 shrink-0 items-center gap-4 border-t border-seam/60 bg-vellum-2/60 px-4 text-[10px] uppercase tracking-[0.2em] backdrop-blur-sm">
      {/* Address */}
      <span className="flex items-center gap-1.5 text-print-ghost">
        <span className="hidden sm:inline text-print-faint">buyer</span>
        <span className="font-mono text-print-dim">{truncate(BUYER_ADDR)}</span>
      </span>

      <Divider />

      {/* Balances */}
      <span className="flex items-center gap-1 text-print-faint">
        <span className="text-seal">{balances.pyusd}</span>
        <span>PYUSD</span>
      </span>

      <span className="flex items-center gap-1 text-print-faint">
        <span className="text-print-dim">{balances.kite}</span>
        <span>KITE</span>
      </span>

      <Divider />

      {/* Network */}
      <span className="flex items-center gap-1.5 text-print-ghost">
        <span
          className={`relative flex h-1.5 w-1.5 ${online ? "" : "opacity-40"}`}
        >
          {online && (
            <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-40" />
          )}
          <span
            className={`relative h-1.5 w-1.5 rounded-full ${online ? "bg-sage" : "bg-crimson"}`}
          />
        </span>
        kite-testnet
      </span>

      {block && (
        <>
          <Divider />
          <span className="text-print-ghost">
            <span className="text-print-faint">block</span>{" "}
            <span className="text-print-dim">{block.toLocaleString()}</span>
          </span>
        </>
      )}

      <span className="ml-auto hidden text-print-ghost lg:inline">
        Exec-Pay-Deliver · Quittance Protocol
      </span>
    </div>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-seam-2" />;
}
