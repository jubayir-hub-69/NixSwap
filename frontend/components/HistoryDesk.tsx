"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useWalletActivity } from "@/hooks/useWalletActivity";

const buttonClass =
  "min-h-11 rounded-2xl bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-void disabled:cursor-not-allowed disabled:opacity-40";

function formatTime(timestamp: number | null) {
  if (timestamp === null) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function HistoryDesk({ embedded = false }: { embedded?: boolean }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const activity = useWalletActivity(isConnected ? address : undefined);

  return (
    <main className={embedded ? "flex flex-col gap-4" : "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14"}>
      <section className="glass-panel rounded-[28px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">History</h1>
            <p className="mt-1 text-xs leading-5 text-mist">
              The newest on-chain actions for this wallet on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia.
              Sends, receives, swaps, launches, bridge transfers, and liquidity changes are read from the chain.
            </p>
          </div>
          {isConnected && address ? (
            <button
              type="button"
              className="text-sm text-cyan-glow disabled:opacity-40"
              disabled={activity.status === "loading" || activity.refreshing}
              onClick={() => activity.reload()}
            >
              Refresh
            </button>
          ) : null}
        </div>
        {!isConnected || !address ? (
          <button type="button" className={`${buttonClass} mt-4`} onClick={() => openConnectModal?.()}>
            Connect wallet
          </button>
        ) : (
          <p className="mt-3 text-xs text-mist">
            Up to 20 matches from recent blocks. Older transactions stay on the block explorer.
          </p>
        )}
      </section>

      {activity.warnings.length > 0 ? (
        <section className="glass-panel rounded-[28px] p-5" data-testid="history-warnings">
          {activity.warnings.map((warning) => (
            <p key={warning} className="text-xs leading-5 text-rose-300">
              {warning}
            </p>
          ))}
        </section>
      ) : null}

      <section className="glass-panel rounded-[28px] p-4 sm:p-5" data-testid="history-list">
        {activity.status === "loading" && activity.rows.length === 0 ? (
          <p className="text-sm text-mist">Reading recent transactions from the chain…</p>
        ) : null}
        {activity.status === "idle" ? <p className="text-sm text-mist">Connect a wallet to read its transactions.</p> : null}
        {activity.status === "ready" && activity.rows.length === 0 && activity.warnings.length === 0 ? (
          <p className="text-sm text-mist">No sends, receives, swaps, launches, bridges, or liquidity changes were found in the recent blocks for this wallet.</p>
        ) : null}
        {activity.rows.length > 0 ? (
          <div className="divide-y divide-white/5">
            {activity.rows.map((row) => (
              <article key={row.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="history-row">
                <div className="min-w-0 sm:w-36">
                  <p className="text-sm font-semibold text-frost">{row.kind}</p>
                  <p className="mt-0.5 text-[11px] text-mist">{row.network}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-frost">{row.amountLabel}</p>
                  <p className="mt-0.5 text-xs leading-5 text-mist">{row.detail}</p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:w-44 sm:flex-col sm:items-end">
                  <p className="text-xs text-mist">{formatTime(row.timestamp)}</p>
                  {row.url ? (
                    <a href={row.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-glow">
                      View transaction
                    </a>
                  ) : (
                    <span className="text-xs text-mist">Explorer unavailable</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
