"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useLaunches } from "@/hooks/useLaunches";
import { asBigint, formatUnits, parseUnits } from "@/lib/amount";
import { errorText, preferredChainId } from "@/lib/deployment";
import { shortAddress } from "@/lib/markets";

const MAX_SUPPLY = 1_000_000_000_000n * 10n ** 18n;
const LIQUIDITY_BPS = 200n;
const BPS = 10_000n;

function seedCapacity(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown> & { 0?: unknown; 1?: unknown; 2?: unknown };
  const seedNix = asBigint(record.seedNix ?? record[0]);
  const available = asBigint(record.available ?? record[1]);
  const launchesRemaining = asBigint(record.launchesRemaining ?? record[2]);
  if (seedNix === undefined || available === undefined || launchesRemaining === undefined) return undefined;
  return { seedNix, available, launchesRemaining };
}

export function LaunchDesk() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const launches = useLaunches();
  const tx = useChainTx();
  const deployment = launches.deployment;
  const seedQuery = useReadContract({
    address: launches.launchpad,
    abi: abis.NixLaunchpad,
    functionName: "seedCapacity",
    chainId: launches.chainId,
    query: { enabled: Boolean(launches.launchpad), refetchInterval: 8_000 },
  });
  const bpsQuery = useReadContract({
    address: launches.launchpad,
    abi: abis.NixLaunchpad,
    functionName: "LIQUIDITY_BPS",
    chainId: launches.chainId,
    query: { enabled: Boolean(launches.launchpad) },
  });
  const seed = seedCapacity(seedQuery.data);
  const liquidityBps = asBigint(bpsQuery.data) ?? LIQUIDITY_BPS;
  const holdingContracts = useMemo(() => {
    if (!address || !launches.chainId) return [];
    return launches.rows.map((row) => ({
      address: row.token,
      abi: abis.LaunchToken,
      functionName: "balanceOf" as const,
      args: [address] as const,
      chainId: launches.chainId,
    }));
  }, [address, launches.chainId, launches.rows]);
  const holdings = useReadContracts({
    contracts: holdingContracts,
    query: { enabled: holdingContracts.length > 0, refetchInterval: 8_000 },
  });
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("");
  const [action, setAction] = useState<"create" | "retire" | null>(null);
  const supplyRaw = /^\d+$/.test(supply) ? parseUnits(supply, 18) : supply === "" ? undefined : null;
  const symbolOk = /^[A-Za-z0-9]{1,11}$/.test(symbol);
  const nameOk = name.trim().length > 0 && name.trim().length <= 32;
  const poolPreview = supplyRaw && supplyRaw > 0n ? (supplyRaw * liquidityBps) / BPS : undefined;
  const creatorPreview = supplyRaw && poolPreview !== undefined ? supplyRaw - poolPreview : undefined;
  const supplyOk =
    supplyRaw !== undefined &&
    supplyRaw !== null &&
    supplyRaw > 0n &&
    supplyRaw <= MAX_SUPPLY &&
    poolPreview !== undefined &&
    poolPreview > 0n;
  const seedReady = Boolean(seed && seed.launchesRemaining > 0n);
  const busy = tx.pending || switching;
  const blocked = launches.active.active;

  async function createToken() {
    if (!launches.launchpad || !launches.chainId || !nameOk || !symbolOk || !supplyOk || !supplyRaw || !seedReady) {
      return;
    }
    tx.clear();
    setAction("create");
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
    } finally {
      setAction(null);
    }
  }

  async function retire() {
    if (!launches.launchpad || !launches.chainId || !launches.active.active) return;
    tx.clear();
    setAction("retire");
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
    } finally {
      setAction(null);
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
          {seed
            ? `Create token is one signature. Your wallet receives 98% of the supply. The contract pairs the other 2% with ${formatUnits(seed.seedNix, 18, 0)} NIX and opens the pool, so the token is on Swap as soon as the transaction confirms. ${seed.launchesRemaining.toString()} opening pools can still be funded. One active launch per wallet.`
            : "Create token is one signature. Your wallet receives 98% of the supply, and the contract opens the NIX pool with the other 2%. One active launch per wallet."}
        </p>
        {launches.loading ? (
          <p className="mt-4 text-sm text-mist">Reading launches…</p>
        ) : !launches.launchpad ? (
          <p className="mt-4 text-sm text-rose-300">The launchpad contract is not on this network yet.</p>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isConnected) openConnectModal?.();
              else if (!deployment) switchChain({ chainId: preferredChainId });
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
                placeholder="0"
                aria-label="Total supply"
                onChange={(event) => setSupply(event.target.value.replace(/\D/g, ""))}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            {creatorPreview !== undefined && poolPreview !== undefined && poolPreview > 0n ? (
              <p className="text-xs text-mist">
                Your wallet receives {formatUnits(creatorPreview, 18)} {symbol || "tokens"}. The opening pool receives{" "}
                {formatUnits(poolPreview, 18)} paired with {seed ? formatUnits(seed.seedNix, 18, 0) : "100"} NIX.
              </p>
            ) : null}
            {seedQuery.isError ? (
              <p className="text-xs text-rose-300">This launchpad cannot seed a pool yet.</p>
            ) : null}
            {seed && !seedReady ? (
              <p className="text-xs text-rose-300">The launchpad seed reserve is empty, so new tokens cannot open a pool.</p>
            ) : null}
            {blocked ? (
              <p className="text-xs text-mist">
                This wallet already has an active token. Retire it before creating another. The token remains public.
              </p>
            ) : null}
            <button
              type="submit"
              data-testid="launch-action"
              aria-busy={action === "create" && tx.pending}
              disabled={
                Boolean(isConnected && deployment) &&
                (busy || blocked || !nameOk || !symbolOk || !supplyOk || seedQuery.isLoading || !seedReady)
              }
              className="min-h-12 w-full rounded-2xl bg-cyan-glow px-4 py-3 text-sm font-semibold text-void disabled:opacity-40"
            >
              <TxButtonContent
                pending={action === "create" && tx.pending}
                phase={tx.phase}
                idle={
                  !isConnected
                    ? "Connect wallet"
                    : !deployment
                      ? "Switch network"
                      : blocked
                        ? "Active launch in progress"
                        : seedQuery.isLoading
                          ? "Reading seed…"
                          : !seedReady
                            ? seedQuery.isError
                              ? "Launchpad cannot seed"
                              : "Seed reserve empty"
                            : "Create token"
                }
              />
            </button>
            {blocked ? (
              <button
                type="button"
                data-testid="retire-action"
                aria-busy={action === "retire" && tx.pending}
                disabled={busy}
                onClick={() => void retire()}
                className="min-h-11 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm text-frost disabled:opacity-40"
              >
                <TxButtonContent pending={action === "retire" && tx.pending} phase={tx.phase} idle="Retire active launch" />
              </button>
            ) : null}
          </form>
        )}
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={launches.chainId} />
      </section>

      <section className="glass-panel rounded-[28px] p-5" data-testid="launch-list">
        <h2 className="text-sm font-semibold">Launched tokens</h2>
        <p className="mt-1 text-xs text-mist">
          {deployment ? `${deployment.network} · NixLaunchpad` : "Connect on a deployed testnet"}
          {launches.count !== undefined ? ` · ${launches.count.toString()} created` : ""}
        </p>
        {launches.loading ? <p className="mt-3 text-sm text-mist">Reading launches…</p> : null}
        {!launches.loading && launches.error && launches.rows.length === 0 ? (
          <p className="mt-3 text-sm text-rose-300">{errorText(launches.error)}</p>
        ) : null}
        {!launches.loading && !launches.error && launches.count === 0n ? (
          <p className="mt-3 text-sm text-mist">No tokens yet. The first launch will show up here for everyone.</p>
        ) : null}
        {!launches.loading && !launches.error && launches.count !== undefined && launches.count > 0n && launches.rows.length === 0 ? (
          <p className="mt-3 text-sm text-rose-300">The launchpad lists tokens, but this page could not decode them.</p>
        ) : null}
        <div className="mt-3 space-y-3">
          {launches.rows.map((row, index) => {
            const holding = holdings.data?.[index];
            const held = holding?.status === "success" && typeof holding.result === "bigint" ? holding.result : undefined;
            const showHolding = Boolean(address && row.creator.toLowerCase() === address.toLowerCase());
            return (
            <article key={row.token} className="rounded-2xl border border-white/10 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-frost">
                    {row.name} <span className="text-cyan-glow">{row.symbol}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-mist">
                    {formatUnits(row.supply, 18, 2)} supply · {shortAddress(row.creator)}
                  </p>
                  {showHolding ? (
                    <p className="mt-1 text-[11px] text-mist" data-testid="creator-balance">
                      {held === undefined ? "Reading your wallet…" : `In your wallet: ${formatUnits(held, 18)} ${row.symbol}`}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-mist">
                  {row.active ? "Active" : "Retired"}
                </span>
              </div>
              <Link href={`/?token=${row.token}`} className="mt-2 mr-4 inline-block text-xs text-cyan-glow">
                Trade
              </Link>
              <Link href={`/pool?token=${row.token}`} className="mt-2 inline-block text-xs text-cyan-glow">
                Add more liquidity
              </Link>
            </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
