"use client";

import { useAccount } from "wagmi";
import { useChainHoldings } from "@/hooks/useChainHoldings";
import { useLaunches } from "@/hooks/useLaunches";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { formatUnits } from "@/lib/amount";
import { bridgeChain } from "@/lib/bridge";
import { preferredChainId } from "@/lib/deployment";
import { formatChange } from "@/lib/markets";
import { shareBps, tokenValueNix, weightedChangeBps } from "@/lib/value";

type Row = {
  key: string;
  symbol: string;
  value: bigint | null;
  changeBps: number | null;
  pending: boolean;
};

export function PricedSummary({ showAllocation = false }: { showAllocation?: boolean }) {
  const { address, isConnected } = useAccount();
  const launches = useLaunches();
  const quoted = useMarketQuotes(launches.rows, launches.chainId, launches.deployment?.NixToken);
  const bookChain = launches.chainId ?? preferredChainId;
  const book = useChainHoldings(bookChain);
  const network = bridgeChain(bookChain)?.name ?? book.network ?? "this network";
  const nix = launches.deployment?.NixToken?.toLowerCase();
  const connected = Boolean(isConnected && address);

  const rows: Row[] = book.holdings.map((holding) => {
    const symbol = holding.symbol ?? "Token";
    const pending = holding.loading || holding.balance === undefined || holding.decimals === undefined;
    if (!connected || pending || holding.error || holding.balance === undefined) {
      return { key: holding.address, symbol, value: null, changeBps: null, pending: pending || holding.error };
    }
    if (nix && holding.address.toLowerCase() === nix) {
      return { key: holding.address, symbol, value: holding.balance, changeBps: null, pending: false };
    }
    const quote = quoted.quotes.find((item) => item.token.toLowerCase() === holding.address.toLowerCase());
    if (!quote?.ready || quote.price <= 0n) {
      return { key: holding.address, symbol, value: null, changeBps: null, pending: false };
    }
    return {
      key: holding.address,
      symbol,
      value: tokenValueNix(holding.balance, quote.price),
      changeBps: quote.change,
      pending: false,
    };
  });

  const quotesPending = Boolean(launches.deployment?.NixToken) && launches.rows.some((row) => {
    const quote = quoted.quotes.find((item) => item.token.toLowerCase() === row.token.toLowerCase());
    return !quote || (!quote.ready && !quote.failed);
  });
  const reading = !launches.chainId || book.loading || quoted.loading || quotesPending || rows.some((row) => row.pending);
  const priced = rows.filter((row): row is Row & { value: bigint } => row.value !== null);
  const total = priced.reduce((sum, row) => sum + row.value, 0n);
  const change = weightedChangeBps(priced.map((row) => ({ value: row.value, changeBps: row.changeBps })));
  const unpriced = connected && !reading ? rows.filter((row) => row.value === null && !row.pending).length : 0;

  return (
    <section className="glass-panel rounded-[28px] p-5" data-testid="priced-summary">
      <p className="text-[11px] uppercase tracking-wide text-mist">Priced value · {network}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-frost" data-testid="priced-value">
        {!connected ? "Connect to read" : reading ? "Reading…" : `${formatUnits(total, 18, 2)} NIX`}
      </p>
      <p className="mt-1 text-sm text-mist" data-testid="priced-change">
        {!connected || reading
          ? "24h change is priced after balances and pool marks load."
          : change === null
            ? "24h change unavailable. NIX is the quote asset, and no held token has a pool mark yet."
            : `${formatChange(change)} from pool marks on held tokens`}
      </p>
      {unpriced > 0 ? (
        <p className="mt-2 text-xs text-mist">
          {unpriced} {unpriced === 1 ? "asset is" : "assets are"} left out of this total because {network} has no spot price for {unpriced === 1 ? "it" : "them"}.
        </p>
      ) : null}
      {showAllocation && connected && !reading ? (
        <div className="mt-4 space-y-2" data-testid="allocation">
          {priced.length === 0 ? <p className="text-xs text-mist">No priced balance on {network}.</p> : null}
          {priced.map((row) => {
            const share = shareBps(row.value, total);
            return (
              <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-frost">{row.symbol}</span>
                <span className="text-mist">
                  {formatUnits(row.value, 18, 2)} NIX
                  {share === null ? "" : ` · ${(share / 100).toFixed(2)}%`}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
