"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useLaunches } from "@/hooks/useLaunches";
import { formatUnits, parseUnits } from "@/lib/amount";
import { deployedChains } from "@/lib/deployment";
import { shortAddress } from "@/lib/markets";

const MAX_SUPPLY = 1_000_000_000_000n * 10n ** 18n;

export function LaunchDesk() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const launches = useLaunches();
  const tx = useChainTx();
  const deployment = launches.deployment;
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("");
  const supplyRaw = /^\d+$/.test(supply) ? parseUnits(supply, 18) : supply === "" ? undefined : null;
  const symbolOk = /^[A-Za-z0-9]{1,11}$/.test(symbol);
  const nameOk = name.trim().length > 0 && name.trim().length <= 32;
  const supplyOk = supplyRaw !== undefined && supplyRaw !== null && supplyRaw > 0n && supplyRaw <= MAX_SUPPLY;
  const busy = tx.pending || switching;
  const blocked = launches.active.active;

  async function createToken() {
    if (!launches.launchpad || !launches.chainId || !nameOk || !symbolOk || !supplyOk || !supplyRaw) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: launches.launchpad!,
          abi: abis.NixLaunchpad,
          functionName: "createToken",
          args: [name.trim(), symbol.toUpperCase(), supplyRaw],
          chainId: launches.chainId,
        }),
      );
      setName("");
      setSymbol("");
      setSupply("");
      await launches.refetch();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Launch failed.");
    }
  }

  async function retire() {
    if (!launches.launchpad || !launches.chainId || !launches.active.active) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: launches.launchpad!,
          abi: abis.NixLaunchpad,
          functionName: "retire",
          args: [BigInt(launches.active.id)],
          chainId: launches.chainId,
        }),
      );
      await launches.refetch();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Retire failed.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Launch</h1>
        <p className="mt-1 text-xs text-mist">
          {deployment ? deployment.network : "Connect on a deployed testnet"}
        </p>
        <p className="mt-3 text-sm leading-6 text-mist">
          Create a fixed-supply token and its public NIX pool. One active launch per wallet. Retired tokens stay listed.
        </p>
        {!launches.launchpad ? (
          <p className="mt-4 text-sm text-rose-300">The launchpad contract is not on this network yet.</p>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isConnected) openConnectModal?.();
              else if (!deployment) switchChain({ chainId: deployedChains[0].chainId });
              else void createToken();
            }}
          >
            <label className="block text-xs text-mist">
              Token name
              <input
                data-testid="launch-name"
                value={name}
                maxLength={32}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
              />
            </label>
            <label className="block text-xs text-mist">
              Symbol
              <input
                data-testid="launch-symbol"
                value={symbol}
                maxLength={11}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
              />
            </label>
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="text-xs text-mist">Total supply</span>
              <input
                data-testid="launch-supply"
                value={supply}
                inputMode="numeric"
                placeholder="1000000"
                aria-label="Total supply"
                onChange={(event) => setSupply(event.target.value.replace(/\D/g, ""))}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            {blocked ? (
              <p className="text-xs text-mist">
                This wallet already has an active token. Retire it before creating another. The token remains public.
              </p>
            ) : null}
            <button
              type="submit"
              data-testid="launch-action"
              disabled={Boolean(deployment) && (busy || blocked || !nameOk || !symbolOk || !supplyOk)}
              className="min-h-12 w-full rounded-2xl bg-cyan-glow px-4 py-3 text-sm font-semibold text-void disabled:opacity-40"
            >
              {!isConnected
                ? "Connect wallet"
                : !deployment
                  ? "Switch network"
                  : blocked
                    ? "Active launch in progress"
                    : tx.pending && tx.phase
                      ? tx.phase
                      : "Create token"}
            </button>
            {blocked ? (
              <button
                type="button"
                data-testid="retire-action"
                disabled={busy}
                onClick={() => void retire()}
                className="min-h-11 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm text-frost disabled:opacity-40"
              >
                Retire active launch
              </button>
            ) : null}
          </form>
        )}
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={launches.chainId} />
      </section>

      <section className="glass-panel rounded-[28px] p-5" data-testid="launch-list">
        <h2 className="text-sm font-semibold">Launched tokens</h2>
        {launches.loading ? <p className="mt-3 text-sm text-mist">Reading launches…</p> : null}
        {!launches.loading && launches.rows.length === 0 ? (
          <p className="mt-3 text-sm text-mist">No tokens yet. The first launch will show up here for everyone.</p>
        ) : null}
        <div className="mt-3 space-y-3">
          {launches.rows.map((row) => (
            <article key={row.token} className="rounded-2xl border border-white/10 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-frost">
                    {row.name} <span className="text-cyan-glow">{row.symbol}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-mist">
                    {formatUnits(row.supply, 18, 2)} supply · {shortAddress(row.creator)}
                  </p>
                </div>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-mist">
                  {row.active ? "Active" : "Retired"}
                </span>
              </div>
              <Link href={`/pool?token=${row.token}`} className="mt-2 inline-block text-xs text-cyan-glow">
                Add liquidity
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
