"use client";

import Link from "next/link";
import { useLaunches } from "@/hooks/useLaunches";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { formatUnits } from "@/lib/amount";
import { errorText } from "@/lib/deployment";
import { formatChange, formatPrice, shortAddress, type LaunchRow, type MarketFigures } from "@/lib/markets";

type Quote = LaunchRow & MarketFigures;

function priceLabel(row: Quote) {
  if (!row.ready) return row.failed ? "Unavailable" : "Reading…";
  return formatPrice(row.price);
}

function reserveLabel(row: Quote, value: bigint | undefined) {
  if (!row.ready) return row.failed ? "Unavailable" : "Reading…";
  return formatUnits(value ?? 0n, 18, 2);
}

function StatCard({ title, rows }: { title: string; rows: Quote[] }) {
  return (
    <section className="glass-panel rounded-[28px] p-4">
      <h2 className="text-sm font-semibold text-frost">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-xs text-mist">No priced markets yet.</p> : null}
        {rows.map((row) => (
          <Link
            key={row.token}
            href={`/pool?token=${row.token}`}
            className="flex items-center justify-between gap-3 rounded-2xl px-2 py-2 hover:bg-white/5"
          >
            <span>
              <span className="block text-sm text-frost">{row.symbol}</span>
              <span className="block text-[11px] text-mist">{priceLabel(row)}</span>
            </span>
            <span className={row.ready && row.change !== null && row.change > 0 ? "text-emerald-300" : row.ready && row.change !== null && row.change < 0 ? "text-rose-300" : "text-mist"}>
              {row.ready && row.change !== null ? formatChange(row.change) : "—"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MarketsBoard() {
  const launches = useLaunches();
  const quoted = useMarketQuotes(launches.rows, launches.chainId, launches.deployment?.NixToken);
  const quotes: Quote[] = quoted.quotes;
  const priced = quotes.filter((row): row is Quote & { ready: true } => row.ready && row.price > 0n);
  const gainers = [...priced].sort((left, right) => (right.change ?? 0) - (left.change ?? 0)).slice(0, 5);
  const losers = [...priced].sort((left, right) => (left.change ?? 0) - (right.change ?? 0)).slice(0, 5);
  const trending = quotes
    .filter((row): row is Quote & { ready: true } => row.ready)
    .sort((left, right) => {
      const leftVolume = left.volume24h ?? 0n;
      const rightVolume = right.volume24h ?? 0n;
      if (leftVolume === rightVolume) return left.reserveNix > right.reserveNix ? -1 : 1;
      return leftVolume > rightVolume ? -1 : 1;
    })
    .slice(0, 5);
  const readyVolumes = quotes.filter((row) => row.ready);
  const totalVolume =
    readyVolumes.length === 0
      ? undefined
      : readyVolumes.reduce((sum, row) => sum + (row.volume24h ?? 0n), 0n);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Markets</h1>
            <p className="mt-1 text-xs text-mist">
              {launches.deployment ? launches.deployment.network : "Connect on a deployed testnet"}
            </p>
          </div>
          <p className="text-sm text-mist" data-testid="market-volume">
            24h NIX volume{" "}
            <span className="text-frost">
              {totalVolume === undefined ? "Reading…" : formatUnits(totalVolume, 18, 2)}
            </span>
          </p>
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-mist">
          Spot prices and pool reserves are public. A wallet&apos;s swap size and limit stay encrypted. The 24h
          column is the on-chain move since the daily price mark. Until that mark rolls, it shows the change since
          launch or the last reserve update. Volume is NIX added to the pool during the current window.
        </p>
      </section>

      {!launches.launchpad && !launches.loading ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">
          This network does not have the launchpad yet. Deploy NixLaunchpad, then the token list will load from the contract.
        </section>
      ) : launches.loading && quotes.length === 0 ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">Reading launches…</section>
      ) : launches.error && quotes.length === 0 ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-rose-300">{errorText(launches.error)}</section>
      ) : quotes.length === 0 ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">
          No tokens have been launched on this network.
        </section>
      ) : (
        <>
          {quoted.error ? (
            <p className="text-sm text-rose-300">{errorText(quoted.error)}</p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Top gainers" rows={gainers} />
            <StatCard title="Top losers" rows={losers} />
            <StatCard title="Trending" rows={trending} />
          </div>
          <section className="glass-panel overflow-x-auto rounded-[28px] p-4" data-testid="market-table">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-mist">
                <tr>
                  <th className="px-3 py-2 font-medium">Token</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">24h</th>
                  <th className="px-3 py-2 font-medium">24h volume</th>
                  <th className="px-3 py-2 font-medium">NIX reserve</th>
                  <th className="px-3 py-2 font-medium">Token reserve</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((row) => (
                  <tr key={row.token} className="border-t border-white/5">
                    <td className="px-3 py-3">
                      <Link href={`/pool?token=${row.token}`} className="text-frost hover:text-cyan-glow">
                        {row.symbol}
                      </Link>
                      <span className="mt-0.5 block text-[11px] text-mist">
                        {row.name} · {shortAddress(row.token)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-frost">{priceLabel(row)}</td>
                    <td className={`px-3 py-3 ${row.ready && row.change !== null && row.change > 0 ? "text-emerald-300" : row.ready && row.change !== null && row.change < 0 ? "text-rose-300" : "text-mist"}`}>
                      {row.ready && row.change !== null ? formatChange(row.change) : "—"}
                    </td>
                    <td className="px-3 py-3 text-frost">
                      {row.ready ? (row.volume24h === undefined ? "—" : formatUnits(row.volume24h, 18, 2)) : row.failed ? "Unavailable" : "Reading…"}
                    </td>
                    <td className="px-3 py-3 text-frost">{reserveLabel(row, row.ready ? row.reserveNix : undefined)}</td>
                    <td className="px-3 py-3 text-frost">{reserveLabel(row, row.ready ? row.reserveToken : undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
