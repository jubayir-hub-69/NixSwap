"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { isAddress, maxUint256 } from "viem";
import { useAccount, useBlock, useEstimateFeesPerGas, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { useFhenix } from "@/hooks/useFhenix";
import { useLaunches } from "@/hooks/useLaunches";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { asBigint, asNumber, decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { deployedChains, preferredChainId } from "@/lib/deployment";
import { formatImpact, formatPrice, minOutAfterSlippage, nixPairFor, priceImpactBps, quoteSwap } from "@/lib/markets";

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
  const [slippageBps, setSlippageBps] = useState(50);
  const [limitTouched, setLimitTouched] = useState(false);
  const [action, setAction] = useState<"trade" | "whitelist" | null>(null);
  const block = useBlock({ chainId: walletChainId, query: { enabled: Boolean(deployment && walletChainId) } });
  const gas = useEstimateFeesPerGas({ chainId: walletChainId, query: { enabled: Boolean(walletChainId) } });
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
  const reserveIn = quote?.ready ? (sellingNix ? quote.reserveNix : quote.reserveToken) : undefined;
  const reserveOut = quote?.ready ? (sellingNix ? quote.reserveToken : quote.reserveNix) : undefined;
  const poolOut =
    quote?.ready && publicAmount && publicAmount > 0n && reserveIn !== undefined && reserveOut !== undefined
      ? quoteSwap(publicAmount, reserveIn, reserveOut)
      : null;
  const impact =
    poolOut && publicAmount && publicAmount > 0n && reserveIn !== undefined && reserveOut !== undefined
      ? priceImpactBps(publicAmount, reserveIn, reserveOut, poolOut)
      : null;
  const suggested = poolOut ? minOutAfterSlippage(poolOut, slippageBps) : null;
  const confidentialStep = 10n ** BigInt(Math.max(places - CONFIDENTIAL_DECIMALS, 0));
  const floored = suggested && suggested >= confidentialStep ? (suggested / confidentialStep) * confidentialStep : null;
  const suggestedText = floored ? plainUnits(floored, places) : "";
  const limitShown = !limitTouched && suggestedText ? suggestedText : limit;
  const limitRaw = parseUnits(limitShown, CONFIDENTIAL_DECIMALS);
  const publicLimit = parseUnits(limitShown, places);
  const abovePool = Boolean(poolOut && publicLimit && publicLimit > poolOut);
  const gasPrice = gas.data?.maxFeePerGas ?? gas.data?.gasPrice;
  const shortPay = Boolean(
    publicAmount && publicAmount > 0n && payBalance.value !== undefined && publicAmount > payBalance.value,
  );
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
  else if (!amount || !limitShown) label = "Enter amount and minimum";
  else if (amountRaw === null || limitRaw === null || amountRaw === 0n || limitRaw === 0n || publicAmount === null) {
    label = "Check the amounts";
  } else if (payBalance.loading) label = "Reading balance…";
  else if (payBalance.error) label = "Balance unavailable";
  else if (shortPay) label = `Not enough ${payToken?.symbol ?? "tokens"}`;
  else if (needsApproval) label = "Approve Token";
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
        !needsApproval &&
        !shortPay &&
        !payBalance.loading &&
        !payBalance.error,
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
          <div className="flex items-center gap-2">
            <p className="rounded-full bg-cyan-glow/10 px-3 py-1 text-xs text-cyan-glow">Shielded</p>
            <Dialog>
              <DialogTrigger className="rounded-full border border-white/10 px-3 py-1 text-xs text-frost" data-testid="swap-settings">
                Settings
              </DialogTrigger>
              <DialogContent title="Swap settings">
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
                <label className="mt-3 block text-xs text-mist">
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
                  <p className="mt-3 text-xs text-mist" data-testid="solver-status">
                    {solverAllowed.isLoading
                      ? "Checking solver…"
                      : solverAllowed.data
                        ? "Solver is whitelisted."
                        : "Solver is not whitelisted on IntentRegistry."}
                  </p>
                ) : null}
              </DialogContent>
            </Dialog>
          </div>
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
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-2 flex items-center justify-between gap-3 text-xs text-mist">
              <span>You pay</span>
              <span data-testid="pay-balance">{tokenBalance(payToken?.symbol, payBalance)}</span>
            </span>
            <span className="flex items-center gap-3">
              <input
                data-testid="pay-input"
                value={amount}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                aria-label="You pay"
                onChange={(event) => {
                  const next = decimalInput(event.target.value);
                  if (next !== null) setAmount(next);
                }}
                className={fieldClass}
              />
              <select
                data-testid="token-in"
                value={tokenIn}
                aria-label="Pay token"
                onChange={(event) => setTokenInChoice(event.target.value)}
                className="max-w-28 rounded-full border border-white/10 bg-ink px-3 py-2 text-sm text-frost"
              >
                {options.map((option) => (
                  <option key={`in-${option.address}`} value={option.address}>
                    {option.symbol}
                  </option>
                ))}
              </select>
            </span>
            <button
              type="button"
              className="mt-2 text-xs text-cyan-glow disabled:opacity-40"
              disabled={payBalance.value === undefined || busy}
              onClick={() => {
                if (payBalance.value !== undefined) setAmount(plainUnits(payBalance.value, payBalance.decimals));
              }}
            >
              Max
            </button>
          </label>
          <div className="flex justify-center">
            <button
              type="button"
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-frost"
              onClick={() => {
                setTokenInChoice(tokenOut);
                setTokenOutChoice(tokenIn);
                setLimitTouched(false);
              }}
            >
              Flip pair
            </button>
          </div>
          <div className="field-well rounded-3xl px-4 py-3">
            <span className="mb-2 flex items-center justify-between gap-3 text-xs text-mist">
              <span>You receive</span>
              <span data-testid="receive-balance">{tokenBalance(receiveToken?.symbol, receiveBalance)}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-2xl font-medium tracking-tight text-frost sm:text-3xl" data-testid="receive-quote">
                {poolOut ? formatUnits(poolOut, places, 6) : pair && quote?.ready === false && !quote.failed ? "Reading…" : "—"}
              </span>
              <select
                data-testid="token-out"
                value={tokenOut}
                aria-label="Receive token"
                onChange={(event) => {
                  setTokenOutChoice(event.target.value);
                  setLimitTouched(false);
                }}
                className="max-w-28 rounded-full border border-white/10 bg-ink px-3 py-2 text-sm text-frost"
              >
                <option value="">Select</option>
                {options.map((option) => (
                  <option key={`out-${option.address}`} value={option.address}>
                    {option.symbol}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="rounded-2xl border border-white/10 px-3 py-3 text-xs text-mist">
            <div className="flex flex-wrap gap-2">
              {[10, 50, 100].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  className={`rounded-full px-3 py-1 ${slippageBps === bps && !limitTouched ? "bg-cyan-glow text-void" : "border border-white/10 text-frost"}`}
                  onClick={() => {
                    setSlippageBps(bps);
                    setLimitTouched(false);
                  }}
                >
                  {(bps / 100).toFixed(2)}%
                </button>
              ))}
            </div>
            <dl className="mt-3 space-y-1">
              <div className="flex justify-between gap-3">
                <dt>Price impact</dt>
                <dd className="text-frost" data-testid="price-impact">{formatImpact(impact)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Network gas price</dt>
                <dd className="text-frost" data-testid="network-fee">
                  {gas.isLoading ? "Reading…" : gasPrice !== undefined ? `${formatUnits(gasPrice, 9, 3)} gwei` : "Unavailable"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Slippage tolerance</dt>
                <dd className="text-frost">{(slippageBps / 100).toFixed(2)}%</dd>
              </div>
            </dl>
            <p className="mt-2 leading-5">
              The wallet quotes this swap&apos;s ETH fee when you sign. The encrypted proof is built first, so that fee is not known yet.
            </p>
          </div>
          <p className="text-xs text-mist" data-testid="pool-price">
            {!pair
              ? "Pool price appears after that token has a NIX pair."
              : !quote?.ready
                ? quote?.failed
                  ? "Pool price unavailable."
                  : "Pool price Reading…"
                : `Pool price ${formatPrice(quote.price)}`}
            {poolOut ? ` · Pool pays ${formatUnits(poolOut, places)} ${receiveToken?.symbol ?? ""}` : ""}
          </p>
          {abovePool ? (
            <p className="text-xs text-rose-300" data-testid="limit-warning">
              This minimum is above the pool payout, so the solver leaves the order open.
            </p>
          ) : null}
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
              <span>Minimum received</span>
              <button
                type="button"
                className="text-cyan-glow disabled:opacity-40"
                disabled={!suggestedText}
                onClick={() => setLimitTouched(false)}
              >
                Use {(slippageBps / 100).toFixed(2)}% slippage
              </button>
            </span>
            <input
              data-testid="limit-input"
              value={limitShown}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="Minimum received"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) {
                  setLimitTouched(true);
                  setLimit(next);
                }
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
          <p className="text-xs text-mist" data-testid="settlement-note">
            A confirmed order stores the encrypted amount. Token balances change when the whitelisted solver fills it,
            before the order expires.
          </p>
          {isOwner && solverAddress && solverAllowed.data === false ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void whitelist()}
              aria-busy={action === "whitelist" && tx.pending}
              className="btn-ghost h-11 w-full rounded-2xl text-sm font-semibold"
            >
              <TxButtonContent pending={action === "whitelist" && tx.pending} phase={tx.phase} idle="Whitelist solver" />
            </button>
          ) : null}
          <button
            type="submit"
            data-testid="swap-action"
            aria-busy={action === "trade" && tx.pending}
            disabled={isConnected && deployment ? allowance.isLoading || !(needsApproval || canSubmit) || busy : busy}
            className="btn-primary min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-semibold"
          >
            <TxButtonContent pending={action === "trade" && tx.pending} phase={tx.phase} idle={label} />
          </button>
        </form>
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={walletChainId ?? chainId} />
      </section>
    </main>
  );
}
