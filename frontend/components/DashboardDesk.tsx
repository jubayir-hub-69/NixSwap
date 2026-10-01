"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useAccount } from "wagmi";
import { PricedSummary } from "@/components/PricedSummary";
import { useLaunches } from "@/hooks/useLaunches";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { bridgeChain } from "@/lib/bridge";
import { errorText, preferredChainId } from "@/lib/deployment";
import { formatChange, formatPrice, type LaunchRow, type MarketFigures } from "@/lib/markets";

type Quote = LaunchRow & MarketFigures;

function Movers({ title, rows, testId }: { title: string; rows: Quote[]; testId: string }) {
  return (
    <section className="glass-panel rounded-[28px] p-4" data-testid={testId}>
      <h2 className="text-sm font-semibold text-frost">{title}</h2>
      <div className="mt-3 space-y-1">
        {rows.length === 0 ? <p className="text-xs text-mist">No pool on this network has a spot price yet.</p> : null}
        {rows.map((row) => {
          const up = row.ready && row.change !== null && row.change > 0;
          const down = row.ready && row.change !== null && row.change < 0;
          return (
            <Link
              key={row.token}
              href={`/swap?token=${row.token}`}
              className="flex items-center justify-between gap-3 rounded-2xl px-2 py-2 hover:bg-white/5"
            >
              <span>
                <span className="block text-sm text-frost">{row.symbol}</span>
                <span className="block text-[11px] text-mist">{formatPrice(row.ready ? row.price : 0n)}</span>
              </span>
              <span className={up ? "text-emerald-300" : down ? "text-rose-300" : "text-mist"}>
                {row.ready && row.change !== null ? formatChange(row.change) : "—"}
                <span className="ml-2 text-[11px]" aria-hidden="true">
                  {up ? "▲" : down ? "▼" : "–"}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardDesk() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const launches = useLaunches();
  const quoted = useMarketQuotes(launches.rows, launches.chainId, launches.deployment?.NixToken);
  const network = bridgeChain(launches.chainId ?? preferredChainId)?.name ?? "Arbitrum Sepolia";
  const priced = quoted.quotes.filter((row): row is Quote & { ready: true } => row.ready && row.price > 0n);
  const gainers = [...priced].sort((left, right) => (right.change ?? 0) - (left.change ?? 0)).slice(0, 5);
  const losers = [...priced].sort((left, right) => (left.change ?? 0) - (right.change ?? 0)).slice(0, 5);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-mist">Balances and pool marks from {network}. Prices are in NIX.</p>
        </div>
        {!isConnected ? (
          <button type="button" className="min-h-11 rounded-2xl bg-cyan-glow px-4 text-sm font-semibold text-void" onClick={() => openConnectModal?.()}>
            Connect wallet
          </button>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <PricedSummary />
        <section className="glass-panel rounded-[28px] p-5">
          <h2 className="text-sm font-semibold text-frost">Trade</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/swap" className="rounded-2xl bg-cyan-glow px-3 py-3 text-center text-sm font-semibold text-void">
              Swap
            </Link>
            <Link href="/bridge" className="rounded-2xl border border-white/15 px-3 py-3 text-center text-sm text-frost">
              Bridge
            </Link>
            <Link href="/pool" className="rounded-2xl border border-white/15 px-3 py-3 text-center text-sm text-frost">
              Pool
            </Link>
            <Link href="/launch" className="rounded-2xl border border-white/15 px-3 py-3 text-center text-sm text-frost">
              Launch
            </Link>
          </div>
        </section>
      </div>

      {launches.error && priced.length === 0 ? <p className="text-sm text-rose-300">{errorText(launches.error)}</p> : null}
      {quoted.error ? <p className="text-sm text-rose-300">{errorText(quoted.error)}</p> : null}
      {launches.loading || quoted.loading ? <p className="text-sm text-mist">Reading markets…</p> : null}

      {launches.loading || quoted.loading ? null : (
        <div className="grid gap-4 md:grid-cols-2">
          <Movers title="Top gainers" rows={gainers} testId="top-gainers" />
          <Movers title="Top losers" rows={losers} testId="top-losers" />
        </div>
      )}
    </main>
  );
}
