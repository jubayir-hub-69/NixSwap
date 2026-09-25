"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useBlock, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useFhenix } from "@/hooks/useFhenix";
import { asBigint, asNumber, decimalInput, formatUnits, parseUnits } from "@/lib/amount";
import { deployedChains, deploymentFor } from "@/lib/deployment";

const fieldClass =
  "w-full bg-transparent text-2xl font-medium tracking-tight text-frost outline-none placeholder:text-white/20 sm:text-3xl";

export function IntentForm({
  title,
  intentType,
}: {
  title: string;
  intentType: 0 | 2;
}) {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { fhenixClient } = useFhenix();
  const tx = useChainTx();
  const deployment = deploymentFor(chainId);
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [targetChain, setTargetChain] = useState<number>(deployedChains[0].chainId);
  const [solver, setSolver] = useState("");
  const [minutes, setMinutes] = useState("30");
  const block = useBlock({ chainId, query: { enabled: Boolean(deployment) } });

  const token = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "symbol",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const confidentialDecimals = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "confidentialDecimals",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const balance = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && address) },
  });
  const publicDecimals = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "decimals",
    chainId,
    query: { enabled: Boolean(deployment) },
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
  const solverAddress = isAddress(solver) ? solver : undefined;
  const solverAllowed = useReadContract({
    address: deployment?.IntentRegistry,
    abi: abis.IntentRegistry,
    functionName: "isSolver",
    args: solverAddress ? [solverAddress] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && solverAddress) },
  });

  const decimals = asNumber(confidentialDecimals.data);
  const amountRaw = decimals === undefined ? undefined : parseUnits(amount, decimals);
  const limitRaw = decimals === undefined ? undefined : parseUnits(limit, decimals);
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
  const symbol = typeof token.data === "string" ? token.data : "token";
  const publicBalance = asBigint(balance.data);
  const publicDecimalCount = asNumber(publicDecimals.data);
  const isOwner = Boolean(address && owner.data && address.toLowerCase() === String(owner.data).toLowerCase());

  async function whitelist() {
    if (!deployment || !solverAddress || !chainId) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.IntentRegistry,
          abi: abis.IntentRegistry,
          functionName: "setSolver",
          args: [solverAddress, true],
          chainId,
        }),
      );
      await solverAllowed.refetch();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  async function submitIntent() {
    if (
      !deployment ||
      !chainId ||
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
          functionName: "submitIntent",
          args: [
            intentType,
            encrypted.encryptedAmount,
            encrypted.encryptedTargetChain,
            encrypted.encryptedLimit,
            encrypted.inputProof,
            solverAddress,
            expiresAt,
          ],
          chainId,
        }),
      );
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  const busy = tx.pending || switching;
  let label = "Encrypt and submit intent";
  if (!isConnected) label = "Connect wallet";
  else if (!deployment) label = switching ? "Switching network…" : "Switch network";
  else if (confidentialDecimals.isLoading || maxWindow.isLoading) label = "Reading contracts…";
  else if (!amount || !limit) label = "Enter amount and limit";
  else if (amountRaw === null || limitRaw === null || amountRaw === 0n || limitRaw === 0n) label = "Check the amounts";
  else if (!solverAddress) label = "Enter a solver address";
  else if (solverAllowed.isLoading) label = "Checking solver…";
  else if (solverAllowed.data === false) label = "Solver is not whitelisted";
  else if (!expiryOk) label = "Choose an expiry inside the intent window";
  else if (tx.phase && tx.phase !== "Confirmed") label = tx.phase;

  const canSubmit =
    Boolean(deployment && solverAddress && amountRaw && limitRaw && expiryOk && solverAllowed.data === true) &&
    !busy;

  return (
    <main className="flex flex-1 justify-center px-4 py-10 sm:py-14">
      <section className="glass-panel w-full max-w-xl rounded-[28px] p-4 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-xs text-mist">
              {deployment ? deployment.network : "Connect on a deployed testnet"}
            </p>
          </div>
          <p className="rounded-full bg-cyan-glow/10 px-3 py-1 text-xs text-cyan-glow">Shielded</p>
        </div>

        <p className="mb-4 text-sm text-mist">
          Balance{" "}
          <span className="text-frost" data-testid="token-balance">
            {balance.isLoading
              ? "Reading…"
              : publicBalance !== undefined && publicDecimalCount !== undefined
                ? `${formatUnits(publicBalance, publicDecimalCount)} ${symbol}`
                : "Connect to read"}
          </span>
        </p>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isConnected) openConnectModal?.();
            else if (!deployment) switchChain({ chainId: deployedChains[0].chainId });
            else if (canSubmit) void submitIntent();
          }}
        >
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="text-xs text-mist">Amount ({decimals ?? "…"} confidential decimals)</span>
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
            <span className="text-xs text-mist">Limit</span>
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
              value={targetChain}
              onChange={(event) => setTargetChain(Number(event.target.value))}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
            >
              {deployedChains.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.network}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-mist">
            Solver
            <input
              data-testid="solver-input"
              value={solver}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x"
              onChange={(event) => setSolver(event.target.value.trim())}
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
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "");
                setMinutes(next);
              }}
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
              className="h-11 w-full rounded-2xl border border-cyan-glow/40 text-sm font-semibold text-cyan-glow disabled:opacity-40"
            >
              Whitelist solver
            </button>
          ) : null}
          <button
            type="submit"
            data-testid="swap-action"
            disabled={isConnected && deployment ? !canSubmit : busy}
            className="h-12 w-full rounded-2xl bg-cyan-glow text-sm font-semibold text-void shadow-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {label}
          </button>
        </form>
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={chainId} />
      </section>
    </main>
  );
}
