"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useLaunches } from "@/hooks/useLaunches";
import { asBigint, decimalInput, formatUnits, parseUnits } from "@/lib/amount";
import { deployedChains } from "@/lib/deployment";
import { formatPrice, quoteAdd } from "@/lib/markets";

export function PoolDesk() {
  const params = useSearchParams();
  const requested = params.get("token");
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const launches = useLaunches();
  const tx = useChainTx();
  const deployment = launches.deployment;
  const chainId = launches.chainId;
  const selected = useMemo(() => {
    const match = launches.rows.find((row) => row.token.toLowerCase() === requested?.toLowerCase());
    return match ?? launches.rows[0];
  }, [launches.rows, requested]);
  const [choice, setChoice] = useState<string | null>(null);
  const active = launches.rows.find((row) => row.token === choice) ?? selected;
  const pair = active?.pair;
  const [nixAmount, setNixAmount] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const [shares, setShares] = useState("");

  const reserveNix = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "reserveNix",
    chainId,
    query: { enabled: Boolean(pair) },
  });
  const reserveToken = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "reserveToken",
    chainId,
    query: { enabled: Boolean(pair) },
  });
  const price = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "priceX18",
    chainId,
    query: { enabled: Boolean(pair) },
  });
  const totalLiquidity = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "totalLiquidity",
    chainId,
    query: { enabled: Boolean(pair) },
  });
  const position = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "liquidityOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(pair && address) },
  });
  const nixAllowance = useReadContract({
    address: deployment?.NixToken,
    abi: abis.LaunchToken,
    functionName: "allowance",
    args: address && pair ? [address, pair] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && address && pair) },
  });
  const tokenAllowance = useReadContract({
    address: active?.token,
    abi: abis.LaunchToken,
    functionName: "allowance",
    args: address && pair ? [address, pair] : undefined,
    chainId,
    query: { enabled: Boolean(active && address && pair) },
  });

  const nixRaw = parseUnits(nixAmount, 18);
  const tokenRaw = parseUnits(tokenAmount, 18);
  const quoted =
    nixRaw && tokenRaw
      ? quoteAdd(
          nixRaw,
          tokenRaw,
          asBigint(reserveNix.data) ?? 0n,
          asBigint(reserveToken.data) ?? 0n,
          asBigint(totalLiquidity.data) ?? 0n,
        )
      : null;
  const nixAllowed = asBigint(nixAllowance.data);
  const tokenAllowed = asBigint(tokenAllowance.data);
  const needsNix = Boolean(quoted && (nixAllowed === undefined || nixAllowed < quoted.nix));
  const needsToken = Boolean(quoted && (tokenAllowed === undefined || tokenAllowed < quoted.token));
  const shareRaw = /^\d+$/.test(shares) ? BigInt(shares) : undefined;
  const owned = asBigint(position.data);
  const busy = tx.pending || switching;
  const spot = asBigint(price.data);

  async function refresh() {
    await Promise.all([
      reserveNix.refetch(),
      reserveToken.refetch(),
      price.refetch(),
      totalLiquidity.refetch(),
      position.refetch(),
      nixAllowance.refetch(),
      tokenAllowance.refetch(),
    ]);
  }

  function fail(error: unknown) {
    tx.fail(error instanceof Error ? error.message : "Transaction failed.");
  }

  async function approve(token: `0x${string}`, amount: bigint) {
    if (!pair || !chainId) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: token,
          abi: abis.LaunchToken,
          functionName: "approve",
          args: [pair, amount],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      fail(error);
    }
  }

  async function deposit() {
    if (!pair || !chainId || !quoted) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: pair,
          abi: abis.NixPair,
          functionName: "addLiquidity",
          args: [quoted.nix, quoted.token],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      fail(error);
    }
  }

  async function withdraw() {
    if (!pair || !chainId || !shareRaw) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: pair,
          abi: abis.NixPair,
          functionName: "removeLiquidity",
          args: [shareRaw],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      fail(error);
    }
  }

  let depositLabel = "Deposit liquidity";
  if (!isConnected) depositLabel = "Connect wallet";
  else if (!deployment) depositLabel = "Switch network";
  else if (!active) depositLabel = "No launched token";
  else if (!quoted) depositLabel = "Enter both amounts";
  else if (needsNix) depositLabel = "Approve NIX";
  else if (needsToken) depositLabel = `Approve ${active.symbol}`;
  if (tx.pending && tx.phase) depositLabel = tx.phase;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Pool</h1>
        <p className="mt-1 text-xs text-mist">Public reserves price the pool. Swap amounts stay encrypted on the Swap page.</p>
        {!launches.launchpad ? (
          <p className="mt-4 text-sm text-rose-300">The launchpad contract is not on this network yet.</p>
        ) : launches.rows.length === 0 ? (
          <p className="mt-4 text-sm text-mist">Launch a token before adding liquidity.</p>
        ) : (
          <>
            <label className="mt-4 block text-xs text-mist">
              Token
              <select
                data-testid="pool-token"
                value={active?.token ?? ""}
                onChange={(event) => setChoice(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
              >
                {launches.rows.map((row) => (
                  <option key={row.token} value={row.token}>
                    {row.symbol} · {row.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 space-y-2 text-sm" data-testid="pool-reserves">
              <div className="flex justify-between gap-3">
                <span className="text-mist">NIX reserve</span>
                <span className="text-frost">
                  {reserveNix.isLoading ? "Reading…" : formatUnits(asBigint(reserveNix.data) ?? 0n, 18)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-mist">{active?.symbol} reserve</span>
                <span className="text-frost">
                  {reserveToken.isLoading ? "Reading…" : formatUnits(asBigint(reserveToken.data) ?? 0n, 18)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-mist">Price</span>
                <span className="text-frost" data-testid="pool-price">
                  {spot === undefined ? "Reading…" : formatPrice(spot)}
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      {active && pair && deployment ? (
        <section className="glass-panel rounded-[28px] p-5">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isConnected) openConnectModal?.();
              else if (!deployment) switchChain({ chainId: deployedChains[0].chainId });
              else if (needsNix && quoted) void approve(deployment.NixToken, quoted.nix);
              else if (needsToken && quoted) void approve(active.token, quoted.token);
              else void deposit();
            }}
          >
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="text-xs text-mist">NIX amount</span>
              <input
                data-testid="deposit-nix"
                value={nixAmount}
                inputMode="decimal"
                placeholder="0"
                aria-label="NIX amount"
                onChange={(event) => {
                  const next = decimalInput(event.target.value);
                  if (next !== null) setNixAmount(next);
                }}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="text-xs text-mist">{active.symbol} amount</span>
              <input
                data-testid="deposit-token"
                value={tokenAmount}
                inputMode="decimal"
                placeholder="0"
                aria-label="Token amount"
                onChange={(event) => {
                  const next = decimalInput(event.target.value);
                  if (next !== null) setTokenAmount(next);
                }}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            {quoted ? (
              <p className="text-xs text-mist">
                The pool will pull {formatUnits(quoted.nix, 18)} NIX and {formatUnits(quoted.token, 18)} {active.symbol}.
              </p>
            ) : null}
            <button
              type="submit"
              data-testid="deposit-action"
              disabled={Boolean(deployment) && (busy || !quoted)}
              className="min-h-12 w-full rounded-2xl bg-cyan-glow px-4 py-3 text-sm font-semibold text-void disabled:opacity-40"
            >
              {depositLabel}
            </button>
          </form>

          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void withdraw();
            }}
          >
            <div className="flex items-center justify-between text-xs text-mist">
              <span>Your pool shares</span>
              <button
                type="button"
                className="text-cyan-glow"
                onClick={() => owned !== undefined && setShares(owned.toString())}
              >
                {owned === undefined ? "Connect to read" : owned.toString()}
              </button>
            </div>
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="text-xs text-mist">Shares to withdraw</span>
              <input
                data-testid="withdraw-input"
                value={shares}
                inputMode="numeric"
                placeholder="0"
                aria-label="Shares to withdraw"
                onChange={(event) => setShares(event.target.value.replace(/\D/g, ""))}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            <button
              type="submit"
              data-testid="withdraw-action"
              disabled={!pair || busy || !shareRaw}
              className="min-h-12 w-full rounded-2xl border border-cyan-glow/40 px-4 py-3 text-sm font-semibold text-cyan-glow disabled:opacity-40"
            >
              {tx.pending && tx.phase ? tx.phase : "Withdraw liquidity"}
            </button>
          </form>
          <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={chainId} />
        </section>
      ) : null}
    </main>
  );
}
