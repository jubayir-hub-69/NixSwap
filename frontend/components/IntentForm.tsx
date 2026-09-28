"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { isAddress, maxUint256 } from "viem";
import { useAccount, useBlock, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { useFhenix } from "@/hooks/useFhenix";
import { useLaunches } from "@/hooks/useLaunches";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { asBigint, asNumber, decimalInput, formatBalance, formatUnits, parseUnits } from "@/lib/amount";
import { deployedChains, preferredChainId } from "@/lib/deployment";
import { formatPrice, nixPairFor } from "@/lib/markets";

const fieldClass =
  "w-full bg-transparent text-2xl font-medium tracking-tight text-frost outline-none placeholder:text-white/20 sm:text-3xl";
const CONFIDENTIAL_DECIMALS = 6;

export function IntentForm({
  title,
  intentType,
}: {
  title: string;
  intentType: 0 | 2;
}) {
  const params = useSearchParams();
  const requestedOut = params.get("token");
  const { address, chainId: walletChainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { fhenixClient } = useFhenix();
  const launches = useLaunches();
  const tx = useChainTx();
  const deployment = launches.deployment;
  const chainId = launches.chainId;
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [tokenInChoice, setTokenInChoice] = useState("");
  const [tokenOutChoice, setTokenOutChoice] = useState("");
  const [solver, setSolver] = useState("");
  const [solverTouched, setSolverTouched] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [action, setAction] = useState<"trade" | "whitelist" | null>(null);
  const block = useBlock({ chainId: walletChainId, query: { enabled: Boolean(deployment && walletChainId) } });
  const targetChain = deployedChains.some((chain) => chain.chainId === walletChainId) ? walletChainId : undefined;

  const options = useMemo(() => {
    const rows = launches.rows.map((row) => ({ address: row.token, symbol: row.symbol, name: row.name }));
    if (!deployment) return rows;
    return [{ address: deployment.NixToken, symbol: "NIX", name: "Nix Token" }, ...rows];
  }, [deployment, launches.rows]);

  const tokenIn = tokenInChoice || deployment?.NixToken || "";
  const tokenOut =
    tokenOutChoice ||
    launches.rows.find((row) => row.token.toLowerCase() === requestedOut?.toLowerCase())?.token ||
    launches.rows.find((row) => row.token !== deployment?.NixToken)?.token ||
    "";
  const solverValue = solverTouched ? solver : solver || deployment?.deployer || "";
  const tokenInAddress = isAddress(tokenIn) ? tokenIn : undefined;
  const tokenOutAddress = isAddress(tokenOut) ? tokenOut : undefined;
  const pair = nixPairFor(launches.rows, tokenInAddress, tokenOutAddress, deployment?.NixToken);
  const route = useMemo(
    () => (pair ? [{ pair: pair.pair, token: pair.token }] : []),
    [pair],
  );
  const quote = useMarketQuotes(route, chainId, deployment?.NixToken).quotes[0];
  const sellingNix = Boolean(deployment && tokenInAddress?.toLowerCase() === deployment.NixToken.toLowerCase());
  const payToken = options.find((option) => option.address.toLowerCase() === tokenInAddress?.toLowerCase());
  const receiveToken = options.find((option) => option.address.toLowerCase() === tokenOutAddress?.toLowerCase());
  const payBalance = useErc20Balance(tokenInAddress, address, chainId);
  const receiveBalance = useErc20Balance(tokenOutAddress, address, chainId);

  const publicDecimals = useReadContract({
    address: tokenInAddress,
    abi: abis.LaunchToken,
    functionName: "decimals",
    chainId,
    query: { enabled: Boolean(tokenInAddress) },
  });
  const allowance = useReadContract({
    address: tokenInAddress,
    abi: abis.LaunchToken,
    functionName: "allowance",
    args: address && deployment ? [address, deployment.IntentRegistry] : undefined,
    chainId,
    query: { enabled: Boolean(tokenInAddress && address && deployment) },
  });
  const maxWindow = useReadContract({
    address: deployment?.IntentRegistry,
    abi: abis.IntentRegistry,
    functionName: "MAX_WINDOW",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const owner = useReadContract({
    address: deployment?.IntentRegistry,
    abi: abis.IntentRegistry,
    functionName: "owner",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const solverAddress = isAddress(solverValue) ? solverValue : undefined;
  const solverAllowed = useReadContract({
    address: deployment?.IntentRegistry,
    abi: abis.IntentRegistry,
    functionName: "isSolver",
    args: solverAddress ? [solverAddress] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && solverAddress) },
  });

  const places = asNumber(publicDecimals.data) ?? 18;
  const amountRaw = parseUnits(amount, CONFIDENTIAL_DECIMALS);
  const publicAmount = parseUnits(amount, places);
  const limitRaw = parseUnits(limit, CONFIDENTIAL_DECIMALS);
  const windowSeconds = asBigint(maxWindow.data);
  const minuteCount = Number(minutes);
  const expiresAt =
    block.data && Number.isInteger(minuteCount) && minuteCount > 0
      ? block.data.timestamp + BigInt(minuteCount * 60)
      : undefined;
  const expiryOk =
    expiresAt !== undefined &&
    windowSeconds !== undefined &&
    block.data !== undefined &&
    expiresAt > block.data.timestamp &&
    expiresAt <= block.data.timestamp + windowSeconds;
  const allowed = asBigint(allowance.data);
  const needsApproval = Boolean(publicAmount && publicAmount > 0n && (allowed === undefined || allowed < publicAmount));
  const isOwner = Boolean(address && owner.data && address.toLowerCase() === String(owner.data).toLowerCase());
  const spotPrice = quote?.ready ? quote.price : undefined;
  const estimate =
    publicAmount && spotPrice && spotPrice > 0n
      ? sellingNix
        ? (publicAmount * 10n ** 18n) / spotPrice
        : (publicAmount * spotPrice) / 10n ** 18n
      : undefined;
  const routeReady = Boolean(tokenInAddress && tokenOutAddress && tokenInAddress.toLowerCase() !== tokenOutAddress.toLowerCase());
  const busy = tx.pending || switching;

  async function whitelist() {
    if (!deployment || !solverAddress || !walletChainId) return;
    tx.clear();
    setAction("whitelist");
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.IntentRegistry,
          abi: abis.IntentRegistry,
          functionName: "setSolver",
          args: [solverAddress, true],
          chainId: walletChainId,
        }),
      );
      await solverAllowed.refetch();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setAction(null);
    }
  }

  async function approve() {
    if (!deployment || !walletChainId || !tokenInAddress) return;
    tx.clear();
    setAction("trade");
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: tokenInAddress,
          abi: abis.LaunchToken,
          functionName: "approve",
          args: [deployment.IntentRegistry, maxUint256],
          chainId: walletChainId,
        }),
      );
      await allowance.refetch();
      await payBalance.refetch();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setAction(null);
    }
  }

  async function submitIntent() {
    if (
      !deployment ||
      !walletChainId ||
      !targetChain ||
      !tokenInAddress ||
      !tokenOutAddress ||
      amountRaw === undefined ||
      amountRaw === null ||
      limitRaw === undefined ||
      limitRaw === null ||
      !solverAddress ||
      !expiresAt
    ) {
      return;
    }
    tx.clear();
    setAction("trade");
    try {
      tx.setPhase("Starting encryption");
      const encrypted = await fhenixClient.encrypt(
        amountRaw,
        targetChain,
        limitRaw,
        deployment.IntentRegistry,
        tx.setPhase,
      );
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.IntentRegistry,
          abi: abis.IntentRegistry,
          functionName: "submitSwapIntent",
          args: [
            tokenInAddress,
            tokenOutAddress,
            intentType,
            encrypted.encryptedAmount,
            encrypted.encryptedTargetChain,
            encrypted.encryptedLimit,
            encrypted.inputProof,
            solverAddress,
            expiresAt,
          ],
          chainId: walletChainId,
        }),
      );
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setAction(null);
    }
  }

  let label = title === "Trade" ? "Trade" : "Swap";
  if (!isConnected) label = "Connect wallet";
  else if (!deployment || !targetChain) label = switching ? "Switching network…" : "Switch network";
  else if (maxWindow.isLoading || allowance.isLoading) label = "Reading contracts…";
  else if (!routeReady) label = "Choose two tokens";
  else if (!amount || !limit) label = "Enter amount and limit";
  else if (amountRaw === null || limitRaw === null || amountRaw === 0n || limitRaw === 0n || publicAmount === null) {
    label = "Check the amounts";
  } else if (needsApproval) label = "Approve Token";
  else if (!solverAddress) label = "Enter a solver address";
  else if (solverAllowed.isLoading) label = "Checking solver…";
  else if (solverAllowed.data === false) label = "Solver is not whitelisted";
  else if (!expiryOk) label = "Choose an expiry inside the intent window";

  function tokenBalance(
    symbol: string | undefined,
    reading: { loading: boolean; error: boolean; value: bigint | undefined; decimals: number },
  ) {
    if (!symbol) return "Select a token";
    if (!address) return "Connect to read";
    return `${symbol} ${formatBalance(true, reading.loading, reading.error, reading.value, reading.decimals)}`;
  }

  const canSubmit =
    Boolean(
      deployment &&
        targetChain &&
        routeReady &&
        solverAddress &&
        amountRaw &&
        limitRaw &&
        publicAmount &&
        expiryOk &&
        solverAllowed.data === true &&
        !needsApproval,
    ) && !busy;

  return (
    <main className="flex flex-1 justify-center px-4 py-10 sm:py-14">
      <section className="glass-panel w-full max-w-xl rounded-[28px] p-4 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-xs text-mist">
              {launches.loading && !deployment
                ? "Reading network…"
                : deployment
                  ? deployment.network
                  : "Connect on a deployed testnet"}
              {deployment && !launches.launchpad ? " · launchpad deploy pending" : ""}
            </p>
          </div>
          <p className="rounded-full bg-cyan-glow/10 px-3 py-1 text-xs text-cyan-glow">Shielded</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isConnected) openConnectModal?.();
            else if (!deployment || !targetChain) switchChain({ chainId: preferredChainId });
            else if (needsApproval && publicAmount) void approve();
            else if (canSubmit) void submitIntent();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-mist">
              Pay
              <select
                data-testid="token-in"
                value={tokenIn}
                onChange={(event) => setTokenInChoice(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
              >
                {options.map((option) => (
                  <option key={`in-${option.address}`} value={option.address}>
                    {option.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-mist">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span>Receive</span>
                <span data-testid="receive-balance">{tokenBalance(receiveToken?.symbol, receiveBalance)}</span>
              </span>
              <select
                data-testid="token-out"
                value={tokenOut}
                onChange={(event) => setTokenOutChoice(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
              >
                <option value="">Select</option>
                {options.map((option) => (
                  <option key={`out-${option.address}`} value={option.address}>
                    {option.symbol}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-mist" data-testid="pool-price">
            {!pair
              ? "Pool price appears after that token has a NIX pair."
              : !quote?.ready
                ? quote?.failed
                  ? "Pool price unavailable."
                  : "Pool price Reading…"
                : `Pool price ${formatPrice(quote.price)}`}
            {estimate !== undefined ? ` · Local estimate ${formatUnits(estimate, places)}` : ""}
          </p>
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
              <span>Amount (encrypted, {CONFIDENTIAL_DECIMALS} decimals)</span>
              <span data-testid="pay-balance">{tokenBalance(payToken?.symbol, payBalance)}</span>
            </span>
            <input
              data-testid="pay-input"
              value={amount}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="Amount"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) setAmount(next);
              }}
              className={fieldClass}
            />
          </label>
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
              <span>Limit (encrypted)</span>
              <span>{tokenBalance(receiveToken?.symbol, receiveBalance)}</span>
            </span>
            <input
              data-testid="limit-input"
              value={limit}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="Limit"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) setLimit(next);
              }}
              className={fieldClass}
            />
          </label>
          <label className="block text-xs text-mist">
            Target chain
            <select
              data-testid="target-chain"
              value={targetChain === undefined ? "" : String(targetChain)}
              disabled
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost disabled:opacity-80"
            >
              {targetChain === undefined ? <option value="">Connect a network</option> : null}
              {deployedChains.map((chain) => (
                <option key={chain.chainId} value={String(chain.chainId)} disabled={chain.chainId !== targetChain}>
                  {chain.network}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-mist">
            Solver
            <input
              data-testid="solver-input"
              value={solverValue}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x"
              onChange={(event) => {
                setSolverTouched(true);
                setSolver(event.target.value.trim());
              }}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 font-mono text-sm text-frost"
            />
          </label>
          <label className="block text-xs text-mist">
            Expiry in minutes
            {windowSeconds !== undefined ? ` (window ${Number(windowSeconds) / 60} min)` : ""}
            <input
              data-testid="expiry-input"
              value={minutes}
              inputMode="numeric"
              onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ""))}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
            />
          </label>
          {solverAddress ? (
            <p className="text-xs text-mist" data-testid="solver-status">
              {solverAllowed.isLoading
                ? "Checking solver…"
                : solverAllowed.data
                  ? "Solver is whitelisted."
                  : "Solver is not whitelisted on IntentRegistry."}
            </p>
          ) : null}
          {isOwner && solverAddress && solverAllowed.data === false ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void whitelist()}
              aria-busy={action === "whitelist" && tx.pending}
              className="h-11 w-full rounded-2xl border border-cyan-glow/40 text-sm font-semibold text-cyan-glow disabled:opacity-40"
            >
              <TxButtonContent pending={action === "whitelist" && tx.pending} phase={tx.phase} idle="Whitelist solver" />
            </button>
          ) : null}
          <button
            type="submit"
            data-testid="swap-action"
            aria-busy={action === "trade" && tx.pending}
            disabled={isConnected && deployment ? allowance.isLoading || !(needsApproval || canSubmit) || busy : busy}
            className="min-h-12 w-full rounded-2xl bg-cyan-glow px-4 py-3 text-sm font-semibold text-void shadow-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <TxButtonContent pending={action === "trade" && tx.pending} phase={tx.phase} idle={label} />
          </button>
        </form>
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={walletChainId ?? chainId} />
      </section>
    </main>
  );
}
