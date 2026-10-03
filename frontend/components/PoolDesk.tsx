"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, usePublicClient, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { useLaunches } from "@/hooks/useLaunches";
import { asBigint, decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { errorText, liveReadQuery, preferredChainId } from "@/lib/deployment";
import { formatPrice, liveReserve, liveSpot, quoteAdd } from "@/lib/markets";
import {
  allowanceCovers,
  clearPoolDraft,
  depositAction,
  displayedAmount,
  maxBalanced,
  poolDraftSnapshot,
  pullFromQuote,
  quoteRemove,
  ratioForEmptySide,
  ratioOut,
  savePoolAmounts,
  savePoolApproval,
  subscribePoolDrafts,
  withdrawAction,
} from "@/lib/pool";

function tokenFromLocation() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

function PoolTokenQuery({ onToken }: { onToken: (token: string | null) => void }) {
  const token = useSearchParams().get("token");
  useEffect(() => {
    onToken(token);
  }, [onToken, token]);
  return null;
}

export function PoolDesk() {
  const [requested, setRequested] = useState<string | null>(tokenFromLocation);
  const { address, chainId: walletChainId, isConnected } = useAccount();
  const client = usePublicClient({ chainId: walletChainId });
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
  const [checking, setChecking] = useState(false);
  const [paid, setPaid] = useState<{ pair: `0x${string}`; account: `0x${string}`; nix: bigint; token: bigint } | null>(
    null,
  );
  const walletNix = useErc20Balance(deployment?.NixToken, address, chainId);
  const walletToken = useErc20Balance(active?.token, address, chainId);
  const pairNixBalance = useErc20Balance(deployment?.NixToken, pair, chainId);
  const pairTokenBalance = useErc20Balance(active?.token, pair, chainId);
  const saved = useSyncExternalStore(
    subscribePoolDrafts,
    () => poolDraftSnapshot(chainId, pair),
    () => null,
  );

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

  const nixDecimals = walletNix.decimals;
  const tokenDecimals = walletToken.decimals;
  const nixField = displayedAmount(nixAmount, saved?.nix);
  const tokenField = displayedAmount(tokenAmount, saved?.token);
  const storedNix = asBigint(reserveNix.data);
  const storedToken = asBigint(reserveToken.data);
  const oneSideBlank = (nixField === "") !== (tokenField === "");
  const balanced = oneSideBlank
    ? ratioForEmptySide(
        nixField === "" ? null : parseUnits(nixField, nixDecimals),
        tokenField === "" ? null : parseUnits(tokenField, tokenDecimals),
        storedNix,
        storedToken,
      )
    : null;
  const nixShown = nixField !== "" ? nixField : balanced ? plainUnits(balanced.nix, nixDecimals) : "";
  const tokenShown = tokenField !== "" ? tokenField : balanced ? plainUnits(balanced.token, tokenDecimals) : "";
  const nixRaw = balanced?.nix ?? parseUnits(nixShown, nixDecimals);
  const tokenRaw = balanced?.token ?? parseUnits(tokenShown, tokenDecimals);
  const supply = asBigint(totalLiquidity.data);
  const reservesReady = storedNix !== undefined && storedToken !== undefined && supply !== undefined;
  const hasRatio = Boolean(storedNix && storedToken && storedNix > 0n && storedToken > 0n);
  const quoted =
    reservesReady && nixRaw && tokenRaw && storedNix !== undefined && storedToken !== undefined && supply !== undefined
      ? quoteAdd(nixRaw, tokenRaw, storedNix, storedToken, supply)
      : null;
  const nixAllowed = asBigint(nixAllowance.data);
  const tokenAllowed = asBigint(tokenAllowance.data);
  const savedGrant =
    saved && address && pair && saved.account === address.toLowerCase()
      ? { pair, account: address, nix: saved.paidNix, token: saved.paidToken }
      : null;
  const grant = paid && pair && address && paid.pair === pair && paid.account === address ? paid : savedGrant;
  const optimisticNix = grant ? grant.nix : 0n;
  const optimisticToken = grant ? grant.token : 0n;
  const nixPending = Boolean(deployment && address && pair && nixAllowed === undefined && !nixAllowance.isError);
  const tokenPending = Boolean(active && address && pair && tokenAllowed === undefined && !tokenAllowance.isError);
  const balanceKnown = walletNix.value !== undefined && walletToken.value !== undefined;
  const balanceProblem = Boolean(address && quoted && (walletNix.error || walletToken.error));
  const balanceLoading = Boolean(address && quoted && !balanceKnown && !balanceProblem);
  const shortNix = Boolean(quoted && walletNix.value !== undefined && quoted.nix > walletNix.value);
  const shortToken = Boolean(quoted && walletToken.value !== undefined && quoted.token > walletToken.value);
  const nixCoverage =
    quoted === null
      ? "ok"
      : allowanceCovers(nixAllowed, nixPending, nixAllowance.isError, optimisticNix, quoted.nix);
  const tokenCoverage =
    quoted === null
      ? "ok"
      : allowanceCovers(tokenAllowed, tokenPending, tokenAllowance.isError, optimisticToken, quoted.token);
  const chainReady = Boolean(deployment && walletChainId && chainId && walletChainId === chainId);
  const depositStep = depositAction({
    connected: isConnected,
    chainReady,
    hasPool: Boolean(active),
    poolReady: reservesReady,
    amountsReady: Boolean(nixRaw && tokenRaw),
    quoteReady: Boolean(quoted),
    balancePending: balanceLoading,
    balanceFailed: balanceProblem,
    shortNix,
    shortToken,
    nix: nixCoverage,
    token: tokenCoverage,
    symbol: active?.symbol ?? "token",
  });
  const shownNix = liveReserve(storedNix, pairNixBalance.value);
  const shownToken = liveReserve(storedToken, pairTokenBalance.value);
  const spot = liveSpot(asBigint(price.data), shownNix, shownToken);
  const shareRaw = /^\d+$/.test(shares) ? BigInt(shares) : undefined;
  const owned = asBigint(position.data);
  const sharesPending = Boolean(address && pair && owned === undefined && !position.isError);
  const sharesFailed = Boolean(address && pair && owned === undefined && position.isError);
  const preview =
    shareRaw && owned !== undefined && storedNix !== undefined && storedToken !== undefined && supply !== undefined
      && shareRaw <= owned
      ? quoteRemove(shareRaw, storedNix, storedToken, supply)
      : null;
  const positionValue =
    owned !== undefined && owned > 0n && storedNix !== undefined && storedToken !== undefined && supply !== undefined
      ? quoteRemove(owned, storedNix, storedToken, supply)
      : null;
  const withdrawStep = withdrawAction({
    connected: isConnected,
    chainReady,
    poolReady: reservesReady,
    sharesPending,
    sharesFailed,
    owned: address ? owned : undefined,
    requested: shareRaw,
    previewReady: Boolean(preview),
  });
  const shareLabel = !address
    ? "Connect to read"
    : sharesPending || owned === undefined
      ? sharesFailed
        ? "Unavailable"
        : "Reading…"
      : owned.toString();
  const busy = tx.pending || switching || action !== null;

  const refetchNixAllowance = nixAllowance.refetch;
  const refetchTokenAllowance = tokenAllowance.refetch;
  const refetchPosition = position.refetch;
  useEffect(() => {
    if (!nixPending && !tokenPending && !sharesPending) return;
    const timer = setInterval(() => {
      if (nixPending) void refetchNixAllowance({ cancelRefetch: true });
      if (tokenPending) void refetchTokenAllowance({ cancelRefetch: true });
      if (sharesPending) void refetchPosition({ cancelRefetch: true });
    }, 12_000);
    return () => clearInterval(timer);
  }, [nixPending, refetchNixAllowance, refetchPosition, refetchTokenAllowance, sharesPending, tokenPending]);

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
    tx.fail(errorText(error));
  }

  function publish(nix: string, token: string) {
    savePoolAmounts(chainId, pair, nix, token);
    setNixAmount(nix);
    setTokenAmount(token);
  }

  function remember(nix: bigint, token: bigint) {
    if (!pair || !address) return;
    savePoolApproval(chainId, pair, address, nix, token);
    setPaid((current) => {
      const base = current && current.pair === pair && current.account === address ? current : { pair, account: address, nix: 0n, token: 0n };
      return {
        pair,
        account: address,
        nix: nix > base.nix ? nix : base.nix,
        token: token > base.token ? token : base.token,
      };
    });
  }

  async function pullNow() {
    if (!client || !pair || !nixRaw || !tokenRaw) throw new Error("Enter both amounts.");
    const value = await client.readContract({
      address: pair,
      abi: abis.NixPair,
      functionName: "quoteAdd",
      args: [nixRaw, tokenRaw],
    });
    const pull = pullFromQuote(value);
    if (!pull) throw new Error("Amount is too small for this pool.");
    return pull;
  }

  function changeNix(value: string) {
    const next = decimalInput(value);
    if (next === null) return;
    if (!hasRatio || storedNix === undefined || storedToken === undefined) {
      publish(next, tokenField);
      return;
    }
    const raw = parseUnits(next, nixDecimals);
    if (raw === null) {
      publish(next, tokenField);
      return;
    }
    if (raw === 0n) {
      publish(next, "");
      return;
    }
    const other = ratioOut(raw, storedNix, storedToken);
    publish(next, other ? plainUnits(other, tokenDecimals) : "");
  }

  function changeToken(value: string) {
    const next = decimalInput(value);
    if (next === null) return;
    if (!hasRatio || storedNix === undefined || storedToken === undefined) {
      publish(nixField, next);
      return;
    }
    const raw = parseUnits(next, tokenDecimals);
    if (raw === null) {
      publish(nixField, next);
      return;
    }
    if (raw === 0n) {
      publish("", next);
      return;
    }
    const other = ratioOut(raw, storedToken, storedNix);
    publish(other ? plainUnits(other, nixDecimals) : "", next);
  }

  function fillMax() {
    if (walletNix.value === undefined || walletToken.value === undefined) return;
    const max = maxBalanced(walletNix.value, walletToken.value, storedNix ?? 0n, storedToken ?? 0n);
    if (!max) return;
    publish(plainUnits(max.nix, nixDecimals), plainUnits(max.token, tokenDecimals));
  }

  async function approve(which: "nix" | "token") {
    if (!pair || !walletChainId || !deployment || !active || !client || walletChainId !== chainId) return;
    const keptNix = nixShown;
    const keptToken = tokenShown;
    savePoolAmounts(chainId, pair, keptNix, keptToken);
    tx.clear();
    setAction("deposit");
    setChecking(true);
    try {
      const fresh = await pullNow();
      const amount = which === "nix"
        ? fresh.nix > (quoted?.nix ?? 0n) ? fresh.nix : (quoted?.nix ?? fresh.nix)
        : fresh.token > (quoted?.token ?? 0n) ? fresh.token : (quoted?.token ?? fresh.token);
      const token = which === "nix" ? deployment.NixToken : active.token;
      setChecking(false);
      await tx.submit(() =>
        tx.writeContractAsync({
          address: token,
          abi: abis.LaunchToken,
          functionName: "approve",
          args: [pair, amount],
          chainId: walletChainId,
        }),
      );
      remember(which === "nix" ? amount : 0n, which === "token" ? amount : 0n);
      await refresh();
      setNixAmount((current) => current || keptNix);
      setTokenAmount((current) => current || keptToken);
    } catch (error) {
      fail(error);
    } finally {
      setChecking(false);
      setAction(null);
    }
  }

  async function deposit() {
    if (!pair || !walletChainId || !address || !client || !deployment || !active || walletChainId !== chainId) return;
    tx.clear();
    setAction("deposit");
    setChecking(true);
    try {
      const fresh = await pullNow();
      const [nixAllow, tokenAllow] = await Promise.all([
        client.readContract({
          address: deployment.NixToken,
          abi: abis.LaunchToken,
          functionName: "allowance",
          args: [address, pair],
        }),
        client.readContract({
          address: active.token,
          abi: abis.LaunchToken,
          functionName: "allowance",
          args: [address, pair],
        }),
      ]);
      if (typeof nixAllow !== "bigint" || typeof tokenAllow !== "bigint") {
        throw new Error("Allowances unavailable.");
      }
      if (nixAllow < fresh.nix || tokenAllow < fresh.token) {
        remember(nixAllow, tokenAllow);
        throw new Error("Approve both tokens for the current pool ratio, then add liquidity.");
      }
      await client.simulateContract({
        address: pair,
        abi: abis.NixPair,
        functionName: "addLiquidity",
        args: [fresh.nix, fresh.token],
        account: address,
      });
      setChecking(false);
      await tx.submit(() =>
        tx.writeContractAsync({
          address: pair,
          abi: abis.NixPair,
          functionName: "addLiquidity",
          args: [fresh.nix, fresh.token],
          chainId: walletChainId,
        }),
      );
      clearPoolDraft(chainId, pair);
      setNixAmount("");
      setTokenAmount("");
      setPaid(null);
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setChecking(false);
      setAction(null);
    }
  }

  async function withdraw() {
    if (!pair || !walletChainId || !address || !client || !shareRaw || walletChainId !== chainId) return;
    tx.clear();
    setAction("withdraw");
    setChecking(true);
    try {
      await client.simulateContract({
        address: pair,
        abi: abis.NixPair,
        functionName: "removeLiquidity",
        args: [shareRaw],
        account: address,
      });
      setChecking(false);
      await tx.submit(() =>
        tx.writeContractAsync({
          address: pair,
          abi: abis.NixPair,
          functionName: "removeLiquidity",
          args: [shareRaw],
          chainId: walletChainId,
        }),
      );
      setShares("");
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setChecking(false);
      setAction(null);
    }
  }

  function go(next: "connect" | "switch" | "approve-nix" | "approve-token" | "add" | "withdraw") {
    if (next === "connect") openConnectModal?.();
    else if (next === "switch") switchChain({ chainId: chainId ?? preferredChainId });
    else if (next === "approve-nix") void approve("nix");
    else if (next === "approve-token") void approve("token");
    else if (next === "add") void deposit();
    else void withdraw();
  }

  let depositHint = "";
  if (quoted && active) {
    depositHint = `The pool will pull ${formatUnits(quoted.nix, nixDecimals)} NIX and ${formatUnits(quoted.token, tokenDecimals)} ${active.symbol}.`;
    if (depositStep.action === "approve-nix") depositHint += " Approve NIX, then approve the token.";
    else if (depositStep.action === "approve-token") depositHint += " NIX is approved. Approve the token next.";
    else if (depositStep.action === "add") depositHint += " Both approvals cover this deposit.";
    else if (shortNix) depositHint += ` This wallet holds ${formatUnits(walletNix.value ?? 0n, nixDecimals)} NIX.`;
    else if (shortToken) {
      depositHint += ` This wallet holds ${formatUnits(walletToken.value ?? 0n, tokenDecimals)} ${active.symbol}.`;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <Suspense fallback={null}>
        <PoolTokenQuery onToken={setRequested} />
      </Suspense>
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Pool</h1>
        <p className="mt-1 text-xs text-mist">
          A launch opens the pool itself. Opening liquidity stays in the pool. This page adds a further deposit, or
          withdraws shares from a deposit you added.
        </p>
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
            onReset={(event) => event.preventDefault()}
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              if (
                depositStep.action === "connect" ||
                depositStep.action === "switch" ||
                depositStep.action === "approve-nix" ||
                depositStep.action === "approve-token" ||
                depositStep.action === "add"
              ) {
                go(depositStep.action);
              }
            }}
          >
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
                <span>NIX amount</span>
                <span className="inline-flex items-center gap-2">
                  <span data-testid="pool-nix-balance">
                    {formatBalance(Boolean(address), walletNix.loading, walletNix.error, walletNix.value, walletNix.decimals)}
                  </span>
                  {walletNix.value !== undefined && walletNix.value > 0n && walletToken.value !== undefined && walletToken.value > 0n ? (
                    <button type="button" className="text-cyan-glow" onClick={fillMax}>
                      Max
                    </button>
                  ) : null}
                </span>
              </span>
              <input
                data-testid="deposit-nix"
                value={nixShown}
                inputMode="decimal"
                placeholder="0"
                aria-label="NIX amount"
                onChange={(event) => changeNix(event.target.value)}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            <label className="field-well block rounded-3xl px-4 py-3">
              <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
                <span>{active.symbol} amount</span>
                <span data-testid="pool-token-balance">
                  {formatBalance(
                    Boolean(address),
                    walletToken.loading,
                    walletToken.error,
                    walletToken.value,
                    walletToken.decimals,
                  )}
                </span>
              </span>
              <input
                data-testid="deposit-token"
                value={tokenShown}
                inputMode="decimal"
                placeholder="0"
                aria-label="Token amount"
                onChange={(event) => changeToken(event.target.value)}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
            </label>
            {hasRatio ? (
              <p className="text-xs text-mist">
                The other amount follows the current reserves. {active.symbol} uses {formatUnits(storedToken ?? 0n, 18)} per{" "}
                {formatUnits(storedNix ?? 0n, 18)} NIX.
              </p>
            ) : null}
            {depositHint ? <p className="text-xs text-mist">{depositHint}</p> : null}
            <button
              type="button"
              data-testid="deposit-action"
              onClick={() => {
                if (busy) return;
                if (
                  depositStep.action === "connect" ||
                  depositStep.action === "switch" ||
                  depositStep.action === "approve-nix" ||
                  depositStep.action === "approve-token" ||
                  depositStep.action === "add"
                ) {
                  go(depositStep.action);
                }
              }}
              aria-busy={action === "deposit"}
              disabled={busy || depositStep.action === "wait"}
              className="btn-primary min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              <TxButtonContent
                pending={action === "deposit"}
                phase={checking && !tx.pending ? "Checking the pool" : tx.phase}
                idle={depositStep.label}
              />
            </button>
          </form>

          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              if (withdrawStep.action === "connect" || withdrawStep.action === "switch" || withdrawStep.action === "withdraw") {
                go(withdrawStep.action);
              }
            }}
          >
            <div className="flex items-center justify-between gap-3 text-xs text-mist">
              <span>Your pool shares</span>
              <button
                type="button"
                className="text-cyan-glow"
                data-testid="pool-shares"
                onClick={() => owned !== undefined && owned > 0n && setShares(owned.toString())}
              >
                {shareLabel}
              </button>
            </div>
            {owned === 0n ? (
              <p className="text-xs text-mist">
                This wallet has no shares. Opening liquidity stays with the launchpad, and a withdrawal of shares you
                do not hold reverts.
              </p>
            ) : positionValue && active ? (
              <p className="text-xs text-mist">
                Your shares are worth {formatUnits(positionValue.nix, 18)} NIX and {formatUnits(positionValue.token, 18)}{" "}
                {active.symbol}.
              </p>
            ) : null}
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
            {preview && active ? (
              <p className="text-xs text-mist" data-testid="withdraw-preview">
                You receive {formatUnits(preview.nix, 18)} NIX and {formatUnits(preview.token, 18)} {active.symbol}.
              </p>
            ) : null}
            <button
              type="submit"
              data-testid="withdraw-action"
              aria-busy={action === "withdraw"}
              disabled={busy || withdrawStep.action === "wait"}
              className="btn-ghost min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              <TxButtonContent
                pending={action === "withdraw"}
                phase={checking && !tx.pending ? "Checking the withdrawal" : tx.phase}
                idle={withdrawStep.label}
              />
            </button>
          </form>
          <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={walletChainId ?? chainId} />
        </section>
      ) : null}
    </main>
  );
}
