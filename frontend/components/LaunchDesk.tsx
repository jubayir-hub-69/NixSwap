"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useLaunches } from "@/hooks/useLaunches";
import { asBigint, formatUnits, parseUnits } from "@/lib/amount";
import { bridgeChain, bridgeChains } from "@/lib/bridge";
import { deploymentFor, errorText, optionalAddress, preferredChainId } from "@/lib/deployment";
import { shortAddress, type LaunchRow } from "@/lib/markets";

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

function chainSlotsOf(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown> & { 0?: unknown; 1?: unknown; 2?: unknown };
  const slots = asBigint(record.slots ?? record[0]);
  const bpsPerChain = asBigint(record.bpsPerChain ?? record[1]);
  const creatorBps = asBigint(record.creatorBps ?? record[2]);
  if (slots === undefined || bpsPerChain === undefined || creatorBps === undefined) return undefined;
  return { slots, bpsPerChain, creatorBps };
}

function pendingEids(data: unknown) {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (typeof item === "bigint" || typeof item === "number") return [Number(item)];
    return [];
  });
}

function bpsLabel(bps: bigint) {
  const whole = bps / 100n;
  const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()}.${fraction}%` : `${whole.toString()}%`;
}

function RemoteSeed({ chainId }: { chainId: number }) {
  const launchpad = optionalAddress(deploymentFor(chainId), "NixLaunchpad");
  const query = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "seedCapacity",
    chainId,
    query: { enabled: Boolean(launchpad), refetchInterval: 12_000 },
  });
  const seed = seedCapacity(query.data);
  const name = bridgeChain(chainId)?.name ?? "Network";
  if (!launchpad) return <p className="text-xs text-rose-300">{name} has no launchpad, so a remote pool cannot be seeded there.</p>;
  if (query.isLoading) return <p className="text-xs text-mist">Reading the seed on {name}…</p>;
  if (query.isError || !seed) return <p className="text-xs text-rose-300">The seed on {name} is unavailable.</p>;
  if (seed.launchesRemaining === 0n) {
    return <p className="text-xs text-rose-300">{name} holds less than one opening seed, so its pool waits until that launchpad is funded.</p>;
  }
  return (
    <p className="text-xs text-mist">
      {name} can fund {seed.launchesRemaining.toString()} opening {seed.launchesRemaining === 1n ? "pool" : "pools"} with{" "}
      {formatUnits(seed.seedNix, 18, 0)} NIX each.
    </p>
  );
}

function LaunchCard({
  row,
  launchpad,
  chainId,
  omnichain,
  held,
  showHolding,
}: {
  row: LaunchRow;
  launchpad: `0x${string}`;
  chainId: number;
  omnichain: boolean;
  held: bigint | undefined;
  showHolding: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const tx = useChainTx();
  const mirror = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "mirrored",
    args: [BigInt(row.id)],
    chainId,
    query: { enabled: omnichain, retry: false },
  });
  const isMirror = mirror.isSuccess && mirror.data === true;
  const pending = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "pendingRemoteEids",
    args: [BigInt(row.id)],
    chainId,
    query: { enabled: omnichain && mirror.isSuccess && !isMirror, refetchInterval: 12_000 },
  });
  const eids = pending.isSuccess ? pendingEids(pending.data) : [];
  const quote = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "quoteRelay",
    args: [BigInt(row.id)],
    chainId,
    query: { enabled: eids.length > 0, refetchInterval: 12_000 },
  });
  const fee = asBigint(quote.data);
  const feeValue = fee === undefined ? undefined : (fee * 11n) / 10n;
  const native = useBalance({
    address,
    chainId,
    query: { enabled: Boolean(address && eids.length > 0), refetchInterval: 12_000 },
  });
  const nativeValue = native.data?.value;
  let relayBlocker: string | null = null;
  if (!isConnected) relayBlocker = null;
  else if (quote.isLoading || feeValue === undefined) relayBlocker = "Reading the relay fee…";
  else if (quote.isError) relayBlocker = errorText(quote.error);
  else if (native.isLoading || nativeValue === undefined) relayBlocker = "Reading the ETH balance for the relay fee…";
  else if (native.isError) relayBlocker = "Could not read the ETH balance for the relay fee.";
  else if (nativeValue < feeValue) {
    relayBlocker = `Relay costs ${formatUnits(feeValue, 18, 8)} ETH. This wallet has ${formatUnits(nativeValue, 18, 8)} ETH.`;
  }
  const canRelay = eids.length > 0 && relayBlocker === null && Boolean(isConnected && feeValue !== undefined);
  const badge = isMirror ? "Omnichain" : row.active ? "Active" : "Retired";

  async function relay() {
    if (!canRelay || feeValue === undefined) return;
    await tx.submit(() =>
      tx.writeContractAsync({
        address: launchpad,
        abi: abis.NixLaunchpad,
        functionName: "relay",
        args: [BigInt(row.id)],
        value: feeValue,
        chainId,
      }),
    );
    await Promise.all([pending.refetch(), quote.refetch()]);
  }

  return (
    <article className="rounded-2xl border border-white/10 px-3 py-3">
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
        <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-mist">{badge}</span>
      </div>
      <Link href={`/?token=${row.token}`} className="mt-2 mr-4 inline-block text-xs text-cyan-glow">
        Trade
      </Link>
      <Link href={`/pool?token=${row.token}`} className="mt-2 inline-block text-xs text-cyan-glow">
        Add more liquidity
      </Link>
      {eids.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] leading-5 text-mist">
            {eids.length === 1 ? "One network still needs this launch." : `${eids.length} networks still need this launch.`}{" "}
            Relay pays LayerZero. The solver can send it, and anyone else can too. Extra ETH is refunded.
          </p>
          {feeValue !== undefined ? (
            <p className="mt-1 text-[11px] text-mist">Relay payment {formatUnits(feeValue, 18, 8)} ETH</p>
          ) : null}
          <button
            type="button"
            data-testid="launch-relay"
            className="mt-2 min-h-11 rounded-2xl border border-white/15 px-4 py-2 text-sm text-frost disabled:opacity-40"
            disabled={tx.pending || (Boolean(isConnected) && !canRelay)}
            onClick={() => {
              if (!isConnected) openConnectModal?.();
              else void relay();
            }}
          >
            <TxButtonContent pending={tx.pending} phase={tx.phase} idle={isConnected ? "Relay launch" : "Connect wallet"} />
          </button>
          {relayBlocker ? <p className="mt-2 text-xs text-rose-300">{relayBlocker}</p> : null}
          <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={chainId} />
        </div>
      ) : null}
      {omnichain && !isMirror && pending.isSuccess && eids.length === 0 ? (
        <p className="mt-2 text-[11px] leading-5 text-mist">
          Relay has been sent. The other networks add their pools after the message lands and each launchpad holds its seed.
        </p>
      ) : null}
    </article>
  );
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
  const slotsQuery = useReadContract({
    address: launches.launchpad,
    abi: abis.NixLaunchpad,
    functionName: "chainSlots",
    chainId: launches.chainId,
    query: { enabled: Boolean(launches.launchpad), retry: false },
  });
  const seed = seedCapacity(seedQuery.data);
  const slots = slotsQuery.isSuccess ? chainSlotsOf(slotsQuery.data) : undefined;
  const legacy = slotsQuery.isError;
  const omnichain = Boolean(slots && slots.slots === 3n);
  const unwired = Boolean(slots && slots.slots !== 3n);
  const termsReady = slotsQuery.isSuccess || slotsQuery.isError;
  const liquidityBps = asBigint(bpsQuery.data) ?? (bpsQuery.isError ? LIQUIDITY_BPS : undefined);
  const bpsPerChain = slots?.bpsPerChain ?? (legacy ? liquidityBps : undefined);
  const poolCount = slots?.slots ?? (legacy ? 1n : undefined);
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
  const perChain =
    supplyRaw && supplyRaw > 0n && bpsPerChain !== undefined ? (supplyRaw * bpsPerChain) / BPS : undefined;
  const creatorPreview =
    supplyRaw && perChain !== undefined && poolCount !== undefined ? supplyRaw - perChain * poolCount : undefined;
  const supplyOk =
    supplyRaw !== undefined &&
    supplyRaw !== null &&
    supplyRaw > 0n &&
    supplyRaw <= MAX_SUPPLY &&
    perChain !== undefined &&
    perChain > 0n &&
    creatorPreview !== undefined &&
    creatorPreview > 0n;
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
        <p className="mt-3 text-sm leading-6 text-mist" data-testid="launch-terms">
          {!launches.launchpad
            ? "Connect on a network where the launchpad is deployed."
            : !termsReady
              ? "Reading the launch terms from this launchpad…"
              : unwired && slots
                ? `This launchpad reports ${slots.slots.toString()} chain ${slots.slots === 1n ? "slot" : "slots"} and needs 3 before a launch can place liquidity on every network. Create stays off until the peers are wired.`
                : omnichain && slots
                  ? `Create token is one signature. Your wallet receives ${bpsLabel(slots.creatorBps)} on this network. Each of the ${slots.slots.toString()} networks opens a pool with ${bpsLabel(slots.bpsPerChain)} of supply${seed ? ` and ${formatUnits(seed.seedNix, 18, 0)} NIX` : ""}. Relay pays LayerZero so the other networks can deploy the token and add that liquidity. The solver sends relay and finishes those pools. ${seed ? `${seed.launchesRemaining.toString()} opening pools can still be funded here. ` : ""}One active launch per wallet.`
                  : legacy
                    ? `This launchpad does not report cross-chain slots. Create token is one signature on this network. Your wallet receives the supply minus the on-chain pool share${liquidityBps !== undefined ? ` (${bpsLabel(liquidityBps)})` : ""}${seed ? `, paired with ${formatUnits(seed.seedNix, 18, 0)} NIX` : ""}. ${seed ? `${seed.launchesRemaining.toString()} opening pools can still be funded. ` : ""}One active launch per wallet.`
                    : "Reading the launch terms from this launchpad…"}
        </p>
        {omnichain ? (
          <div className="mt-3 space-y-1">
            {bridgeChains
              .filter((chain) => chain.chainId !== launches.chainId)
              .map((chain) => (
                <RemoteSeed key={chain.chainId} chainId={chain.chainId} />
              ))}
          </div>
        ) : null}
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
            {creatorPreview !== undefined && perChain !== undefined && perChain > 0n && poolCount !== undefined ? (
              <p className="text-xs text-mist">
                Your wallet receives {formatUnits(creatorPreview, 18)} {symbol || "tokens"} on this network.{" "}
                {poolCount === 1n
                  ? `The opening pool receives ${formatUnits(perChain, 18)}${seed ? ` paired with ${formatUnits(seed.seedNix, 18, 0)} NIX` : ""}.`
                  : `Each of the ${poolCount.toString()} networks pairs ${formatUnits(perChain, 18)}${seed ? ` with ${formatUnits(seed.seedNix, 18, 0)} NIX` : ""}.`}
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
                (busy ||
                  blocked ||
                  !nameOk ||
                  !symbolOk ||
                  !supplyOk ||
                  seedQuery.isLoading ||
                  !seedReady ||
                  !termsReady ||
                  unwired)
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
                        : seedQuery.isLoading || !termsReady
                          ? seedQuery.isLoading
                            ? "Reading seed…"
                            : "Reading launch terms…"
                          : unwired
                            ? "Peers are not wired"
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
          {launches.launchpad && launches.chainId
            ? launches.rows.map((row, index) => {
                const holding = holdings.data?.[index];
                const held = holding?.status === "success" && typeof holding.result === "bigint" ? holding.result : undefined;
                const showHolding = Boolean(address && row.creator.toLowerCase() === address.toLowerCase());
                return (
                  <LaunchCard
                    key={row.token}
                    row={row}
                    launchpad={launches.launchpad!}
                    chainId={launches.chainId!}
                    omnichain={omnichain}
                    held={held}
                    showHolding={showHolding}
                  />
                );
              })
            : null}
        </div>
      </section>
    </main>
  );
}
