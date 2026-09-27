"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { useLaunches } from "@/hooks/useLaunches";
import { formatUnits } from "@/lib/amount";
import { formatChange, formatPrice, liveChange, shortAddress, type LaunchRow } from "@/lib/markets";

const fields = [
  "reserveNix",
  "reserveToken",
  "priceX18",
  "markPriceX18",
  "previousPriceX18",
  "volumeWindowNix",
  "volumeNix",
] as const;

type Quote = {
  launch: LaunchRow;
  reserveNix: bigint;
  reserveToken: bigint;
  price: bigint;
  mark: bigint;
  previous: bigint;
  volume: bigint;
  cumulative: bigint;
  change: number;
  volume24h: bigint;
};

function bigintAt(value: unknown) {
  return typeof value === "bigint" ? value : 0n;
}

function StatCard({ title, rows }: { title: string; rows: Quote[] }) {
  return (
    <section className="glass-panel rounded-[28px] p-4">
      <h2 className="text-sm font-semibold text-frost">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-xs text-mist">No priced markets yet.</p> : null}
        {rows.map((row) => (
          <Link
            key={row.launch.token}
            href={`/pool?token=${row.launch.token}`}
            className="flex items-center justify-between gap-3 rounded-2xl px-2 py-2 hover:bg-white/5"
          >
            <span>
              <span className="block text-sm text-frost">{row.launch.symbol}</span>
              <span className="block text-[11px] text-mist">{formatPrice(row.price)}</span>
            </span>
            <span className={row.change > 0 ? "text-emerald-300" : row.change < 0 ? "text-rose-300" : "text-mist"}>
              {formatChange(row.change)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MarketsBoard() {
  const launches = useLaunches();
  const chainId = launches.chainId;
  const contracts = launches.rows.flatMap((launch) =>
    fields.map((functionName) => ({
      address: launch.pair,
      abi: abis.NixPair,
      functionName,
      chainId,
    })),
  );
  const reads = useReadContracts({
    contracts,
    query: { enabled: launches.rows.length > 0 },
  });
  const baseRows = useMemo(() => {
    return launches.rows.map((launch, index) => {
      const slice = reads.data?.slice(index * fields.length, (index + 1) * fields.length) ?? [];
      const at = (offset: number) => bigintAt(slice[offset]?.result);
      return {
        launch,
        reserveNix: at(0),
        reserveToken: at(1),
        price: at(2),
        mark: at(3),
        previous: at(4),
        volume: at(5),
        cumulative: at(6),
      };
    });
  }, [launches.rows, reads.data]);

  const quotes: Quote[] = baseRows.map((row) => ({
    ...row,
    change: liveChange(row.price, row.mark, row.previous, null),
    volume24h: row.volume,
  }));
  const priced = quotes.filter((row) => row.price > 0n);
  const gainers = [...priced].sort((left, right) => right.change - left.change).slice(0, 5);
  const losers = [...priced].sort((left, right) => left.change - right.change).slice(0, 5);
  const trending = [...quotes]
    .sort((left, right) => {
      if (left.volume24h === right.volume24h) return left.reserveNix > right.reserveNix ? -1 : 1;
      return left.volume24h > right.volume24h ? -1 : 1;
    })
    .slice(0, 5);
  const totalVolume = quotes.reduce((sum, row) => sum + row.volume24h, 0n);

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
            <span className="text-frost">{formatUnits(totalVolume, 18, 2)}</span>
          </p>
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-mist">
          Spot prices and pool reserves are public. A wallet&apos;s swap size and limit stay encrypted. The 24h
          column is the on-chain move since the daily price mark. Until that mark rolls, it shows the change since
          launch or the last reserve update. Volume is NIX added to the pool during the current window.
        </p>
      </section>

      {!launches.launchpad ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">
          This network does not have the launchpad yet. Deploy NixLaunchpad, then the token list will load from the contract.
        </section>
      ) : launches.loading ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">Reading launches…</section>
      ) : quotes.length === 0 ? (
        <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">
          No tokens have been launched on this network.
        </section>
      ) : (
        <>
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
                  <tr key={row.launch.token} className="border-t border-white/5">
                    <td className="px-3 py-3">
                      <Link href={`/pool?token=${row.launch.token}`} className="text-frost hover:text-cyan-glow">
                        {row.launch.symbol}
                      </Link>
                      <span className="mt-0.5 block text-[11px] text-mist">
                        {row.launch.name} · {shortAddress(row.launch.token)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-frost">{formatPrice(row.price)}</td>
                    <td className={`px-3 py-3 ${row.change > 0 ? "text-emerald-300" : row.change < 0 ? "text-rose-300" : "text-mist"}`}>
                      {formatChange(row.change)}
                    </td>
                    <td className="px-3 py-3 text-frost">{formatUnits(row.volume24h, 18, 2)}</td>
                    <td className="px-3 py-3 text-frost">{formatUnits(row.reserveNix, 18, 2)}</td>
                    <td className="px-3 py-3 text-frost">{formatUnits(row.reserveToken, 18, 2)}</td>
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
