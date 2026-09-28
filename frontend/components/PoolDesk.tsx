"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { useLaunches } from "@/hooks/useLaunches";
import { asBigint, decimalInput, formatBalance, formatUnits, parseUnits } from "@/lib/amount";
import { liveReadQuery, preferredChainId } from "@/lib/deployment";
import { formatPrice, liveReserve, liveSpot, quoteAdd } from "@/lib/markets";

export function PoolDesk() {
  const params = useSearchParams();
  const requested = params.get("token");
  const { address, chainId: walletChainId, isConnected } = useAccount();
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
  const [action, setAction] = useState<"deposit" | "withdraw" | null>(null);
  const walletNix = useErc20Balance(deployment?.NixToken, address, chainId);
  const walletToken = useErc20Balance(active?.token, address, chainId);
  const pairNixBalance = useErc20Balance(deployment?.NixToken, pair, chainId);
  const pairTokenBalance = useErc20Balance(active?.token, pair, chainId);

  const reserveNix = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "reserveNix",
    chainId,
    query: { enabled: Boolean(pair), ...liveReadQuery },
  });
  const reserveToken = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "reserveToken",
    chainId,
    query: { enabled: Boolean(pair), ...liveReadQuery },
  });
  const price = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "priceX18",
    chainId,
    query: { enabled: Boolean(pair), ...liveReadQuery },
  });
  const totalLiquidity = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "totalLiquidity",
    chainId,
    query: { enabled: Boolean(pair), ...liveReadQuery },
  });
  const position = useReadContract({
    address: pair,
    abi: abis.NixPair,
    functionName: "liquidityOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(pair && address), ...liveReadQuery },
  });
  const nixAllowance = useReadContract({
    address: deployment?.NixToken,
    abi: abis.LaunchToken,
    functionName: "allowance",
    args: address && pair ? [address, pair] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && address && pair), ...liveReadQuery },
  });
  const tokenAllowance = useReadContract({
    address: active?.token,
    abi: abis.LaunchToken,
    functionName: "allowance",
    args: address && pair ? [address, pair] : undefined,
    chainId,
    query: { enabled: Boolean(active && address && pair), ...liveReadQuery },
  });

  const nixRaw = parseUnits(nixAmount, 18);
  const tokenRaw = parseUnits(tokenAmount, 18);
  const storedNix = asBigint(reserveNix.data);
  const storedToken = asBigint(reserveToken.data);
  const reservesReady = reserveNix.isSuccess && reserveToken.isSuccess && totalLiquidity.isSuccess;
  const quoted =
    reservesReady && nixRaw && tokenRaw
      ? quoteAdd(nixRaw, tokenRaw, storedNix ?? 0n, storedToken ?? 0n, asBigint(totalLiquidity.data) ?? 0n)
      : null;
  const nixAllowed = asBigint(nixAllowance.data);
  const tokenAllowed = asBigint(tokenAllowance.data);
  const allowanceLoading = Boolean(quoted && (nixAllowance.isLoading || tokenAllowance.isLoading));
  const needsNix = Boolean(
    quoted && (nixAllowance.isError || (nixAllowance.isSuccess && (nixAllowed ?? 0n) < quoted.nix)),
  );
  const needsToken = Boolean(
    quoted && (tokenAllowance.isError || (tokenAllowance.isSuccess && (tokenAllowed ?? 0n) < quoted.token)),
  );
  const shownNix = liveReserve(storedNix, pairNixBalance.value);
  const shownToken = liveReserve(storedToken, pairTokenBalance.value);
  const spot = liveSpot(asBigint(price.data), shownNix, shownToken);
  const shareRaw = /^\d+$/.test(shares) ? BigInt(shares) : undefined;
  const owned = asBigint(position.data);
  const busy = tx.pending || switching;

  async function refresh() {
    await Promise.all([
      reserveNix.refetch(),
      reserveToken.refetch(),
      price.refetch(),
      totalLiquidity.refetch(),
      position.refetch(),
      nixAllowance.refetch(),
      tokenAllowance.refetch(),
      walletNix.refetch(),
      walletToken.refetch(),
      pairNixBalance.refetch(),
      pairTokenBalance.refetch(),
    ]);
  }

  function fail(error: unknown) {
    tx.fail(error instanceof Error ? error.message : "Transaction failed.");
  }

  async function approve(token: `0x${string}`, amount: bigint) {
    if (!pair || !walletChainId) return;
    tx.clear();
    setAction("deposit");
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: token,
          abi: abis.LaunchToken,
          functionName: "approve",
          args: [pair, amount],
          chainId: walletChainId,
        }),
      );
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setAction(null);
    }
  }

  async function deposit() {
    if (!pair || !walletChainId || !quoted) return;
    tx.clear();
    setAction("deposit");
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: pair,
          abi: abis.NixPair,
          functionName: "addLiquidity",
          args: [quoted.nix, quoted.token],
          chainId: walletChainId,
        }),
      );
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setAction(null);
    }
  }

  async function withdraw() {
    if (!pair || !walletChainId || !shareRaw) return;
    tx.clear();
    setAction("withdraw");
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: pair,
          abi: abis.NixPair,
          functionName: "removeLiquidity",
          args: [shareRaw],
          chainId: walletChainId,
        }),
      );
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setAction(null);
    }
  }

  let depositLabel = "Add liquidity";
  if (!isConnected) depositLabel = "Connect wallet";
  else if (!deployment || !walletChainId) depositLabel = "Switch network";
  else if (!active) depositLabel = "No launched token";
  else if (!reservesReady) depositLabel = "Reading pool…";
  else if (!quoted) depositLabel = "Enter both amounts";
  else if (allowanceLoading) depositLabel = "Reading allowances…";
  else if (needsNix) depositLabel = "Approve NIX";
  else if (needsToken) depositLabel = `Approve ${active.symbol}`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Pool</h1>
        <p className="mt-1 text-xs text-mist">Public reserves price the pool. Swap amounts stay encrypted on the Swap page.</p>
        {launches.loading && launches.rows.length === 0 ? (
          <p className="mt-4 text-sm text-mist">Reading launches…</p>
        ) : !launches.launchpad ? (
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
                  {!reservesReady && shownNix === undefined ? "Reading…" : formatUnits(shownNix ?? 0n, 18)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-mist">{active?.symbol} reserve</span>
                <span className="text-frost">
                  {!reservesReady && shownToken === undefined ? "Reading…" : formatUnits(shownToken ?? 0n, 18)}
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
              else if (!deployment || !walletChainId) switchChain({ chainId: preferredChainId });
              else if (allowanceLoading || !quoted) return;
              else if (needsNix) void approve(deployment.NixToken, quoted.nix);
              else if (needsToken) void approve(active.token, quoted.token);
              else void deposit();
            }}
          >
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
                <span>NIX amount</span>
                <span data-testid="pool-nix-balance">
                  {formatBalance(Boolean(address), walletNix.loading, walletNix.error, walletNix.value, walletNix.decimals)}
                </span>
              </span>
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
              <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
                <span>{active.symbol} amount</span>
                <span data-testid="pool-token-balance">
                  {formatBalance(Boolean(address), walletToken.loading, walletToken.error, walletToken.value, walletToken.decimals)}
                </span>
              </span>
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
                {needsNix
                  ? " Approve NIX, then approve the token. Reserves update after both approvals and Add liquidity."
                  : needsToken
                    ? " NIX is approved. Approve the token next, then add liquidity."
                    : allowanceLoading
                      ? ""
                      : " Both tokens are approved."}
              </p>
            ) : null}
            <button
              type="submit"
              data-testid="deposit-action"
              aria-busy={action === "deposit" && tx.pending}
              disabled={Boolean(isConnected && deployment) && (busy || !quoted || allowanceLoading)}
              className="min-h-12 w-full rounded-2xl bg-cyan-glow px-4 py-3 text-sm font-semibold text-void disabled:opacity-40"
            >
              <TxButtonContent pending={action === "deposit" && tx.pending} phase={tx.phase} idle={depositLabel} />
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
              aria-busy={action === "withdraw" && tx.pending}
              disabled={!pair || busy || !shareRaw}
              className="min-h-12 w-full rounded-2xl border border-cyan-glow/40 px-4 py-3 text-sm font-semibold text-cyan-glow disabled:opacity-40"
            >
              <TxButtonContent pending={action === "withdraw" && tx.pending} phase={tx.phase} idle="Withdraw liquidity" />
            </button>
          </form>
          <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={walletChainId ?? chainId} />
        </section>
      ) : null}
    </main>
  );
}
