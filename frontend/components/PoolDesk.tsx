"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { isHex } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useFhenix } from "@/hooks/useFhenix";
import { asBigint, asNumber, decimalInput, formatUnits, parseUnits } from "@/lib/amount";
import { deployedChains, deploymentFor } from "@/lib/deployment";

function ReserveRow({
  chainId,
  pool,
  token,
  network,
}: {
  chainId: number;
  pool: `0x${string}`;
  token: `0x${string}`;
  network: string;
}) {
  const reserve = useReadContract({
    address: pool,
    abi: abis.NixPool,
    functionName: "totalReserve",
    chainId,
  });
  const symbol = useReadContract({
    address: token,
    abi: abis.NixToken,
    functionName: "symbol",
    chainId,
  });
  const decimals = useReadContract({
    address: token,
    abi: abis.NixToken,
    functionName: "decimals",
    chainId,
  });
  const value = asBigint(reserve.data);
  const places = asNumber(decimals.data);
  const unit = typeof symbol.data === "string" ? symbol.data : "";
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-mist">{network}</span>
      <span className="text-frost" data-testid={`reserve-${chainId}`}>
        {reserve.isLoading
          ? "Reading…"
          : reserve.error
            ? "Read failed"
            : value !== undefined && places !== undefined
              ? `${formatUnits(value, places)} ${unit}`
              : "—"}
      </span>
    </div>
  );
}

export function PoolDesk() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { fhenixClient } = useFhenix();
  const tx = useChainTx();
  const deployment = deploymentFor(chainId);
  const [deposit, setDeposit] = useState("");
  const [shares, setShares] = useState("");
  const [proof, setProof] = useState("");
  const [revealed, setRevealed] = useState("");

  const symbol = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "symbol",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const decimals = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "decimals",
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
  const allowance = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "allowance",
    args: address && deployment ? [address, deployment.NixPool] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && address) },
  });
  const reserve = useReadContract({
    address: deployment?.NixPool,
    abi: abis.NixPool,
    functionName: "totalReserve",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const shareRate = useReadContract({
    address: deployment?.NixPool,
    abi: abis.NixPool,
    functionName: "shareRate",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const shareDecimals = useReadContract({
    address: deployment?.NixPool,
    abi: abis.NixPool,
    functionName: "SHARE_DECIMALS",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const pending = useReadContract({
    address: deployment?.NixPool,
    abi: abis.NixPool,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && address) },
  });

  const places = asNumber(decimals.data);
  const sharePlaces = asNumber(shareDecimals.data);
  const unit = typeof symbol.data === "string" ? symbol.data : "token";
  const depositRaw = places === undefined ? undefined : parseUnits(deposit, places);
  const shareRaw = sharePlaces === undefined ? undefined : parseUnits(shares, sharePlaces);
  const rate = asBigint(shareRate.data);
  const allowed = asBigint(allowance.data);
  const needsApproval = depositRaw !== undefined && depositRaw !== null && allowed !== undefined && allowed < depositRaw;
  const claimId = pending.data?.[0]?.claimId;
  const revealedRaw = /^\d+$/.test(revealed) ? BigInt(revealed) : undefined;

  async function refresh() {
    await Promise.all([balance.refetch(), allowance.refetch(), reserve.refetch(), pending.refetch()]);
  }

  async function depositLiquidity() {
    if (!deployment || !chainId || !depositRaw) return;
    tx.clear();
    try {
      if (needsApproval) {
        await tx.submit(() =>
          tx.writeContractAsync({
            address: deployment.NixToken,
            abi: abis.NixToken,
            functionName: "approve",
            args: [deployment.NixPool, depositRaw],
            chainId,
          }),
        );
      }
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixPool,
          abi: abis.NixPool,
          functionName: "depositLiquidity",
          args: [depositRaw],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  async function withdrawLiquidity() {
    if (!deployment || !chainId || !shareRaw) return;
    tx.clear();
    try {
      tx.setPhase("Starting encryption");
      const encrypted = await fhenixClient.encryptUint64(shareRaw, deployment.NixPool, tx.setPhase);
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixPool,
          abi: abis.NixPool,
          functionName: "withdrawLiquidity",
          args: [encrypted.hash, encrypted.inputProof],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  async function claimLiquidity() {
    if (!deployment || !chainId || !claimId || revealedRaw === undefined || !isHex(proof)) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixPool,
          abi: abis.NixPool,
          functionName: "claimLiquidity",
          args: [claimId, revealedRaw, proof],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  const busy = tx.pending || switching;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Pool</h1>
        <div className="mt-4 space-y-2" data-testid="pool-reserves">
          {deployedChains.map((chain) => (
            <ReserveRow
              key={chain.chainId}
              chainId={chain.chainId}
              network={chain.network}
              pool={chain.NixPool}
              token={chain.NixToken}
            />
          ))}
        </div>
      </section>

      <section className="glass-panel rounded-[28px] p-5">
        <p className="text-sm text-mist">
          Your balance{" "}
          <span className="text-frost" data-testid="token-balance">
            {balance.isLoading
              ? "Reading…"
              : asBigint(balance.data) !== undefined && places !== undefined
                ? `${formatUnits(asBigint(balance.data)!, places)} ${unit}`
                : "Connect to read"}
          </span>
        </p>
        <p className="mt-1 text-sm text-mist">
          Active reserve{" "}
          <span className="text-frost">
            {asBigint(reserve.data) !== undefined && places !== undefined
              ? `${formatUnits(asBigint(reserve.data)!, places)} ${unit}`
              : deployment
                ? "Reading…"
                : "Switch to a deployed network"}
          </span>
        </p>
        {rate !== undefined && places !== undefined ? (
          <p className="mt-1 text-xs text-mist">
            Share rate {formatUnits(rate, places)} {unit} per confidential share unit
          </p>
        ) : null}

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isConnected) openConnectModal?.();
            else if (!deployment) switchChain({ chainId: deployedChains[0].chainId });
            else void depositLiquidity();
          }}
        >
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="text-xs text-mist">Deposit {unit}</span>
            <input
              data-testid="deposit-input"
              value={deposit}
              inputMode="decimal"
              placeholder="0"
              aria-label="Deposit amount"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) setDeposit(next);
              }}
              className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
            />
          </label>
          <button
            type="submit"
            data-testid="deposit-action"
            disabled={Boolean(deployment) && (busy || !depositRaw)}
            className="h-12 w-full rounded-2xl bg-cyan-glow text-sm font-semibold text-void disabled:opacity-40"
          >
            {!isConnected
              ? "Connect wallet"
              : !deployment
                ? "Switch network"
                : tx.phase && tx.phase !== "Confirmed"
                  ? tx.phase
                  : needsApproval
                    ? "Approve and deposit"
                    : "Deposit liquidity"}
          </button>
        </form>

        <form
          className="mt-6 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void withdrawLiquidity();
          }}
        >
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="text-xs text-mist">
              Burn shares ({sharePlaces ?? "…"} decimals)
            </span>
            <input
              data-testid="withdraw-input"
              value={shares}
              inputMode="decimal"
              placeholder="0"
              aria-label="Shares to burn"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) setShares(next);
              }}
              className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
            />
          </label>
          <button
            type="submit"
            data-testid="withdraw-action"
            disabled={!deployment || busy || !shareRaw}
            className="h-12 w-full rounded-2xl border border-cyan-glow/40 text-sm font-semibold text-cyan-glow disabled:opacity-40"
          >
            Withdraw encrypted shares
          </button>
        </form>

        {pending.data && pending.data.length > 0 ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void claimLiquidity();
            }}
          >
            <p className="text-xs text-mist">
              {pending.data.length} pending withdrawal{pending.data.length === 1 ? "" : "s"}. Claim{" "}
              <span className="font-mono text-frost">{claimId}</span>
            </p>
            <input
              value={revealed}
              inputMode="numeric"
              placeholder="Decrypted share count"
              aria-label="Decrypted share count"
              onChange={(event) => setRevealed(event.target.value.replace(/\D/g, ""))}
              className="w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
            />
            <input
              value={proof}
              placeholder="Decryption proof hex"
              aria-label="Decryption proof"
              onChange={(event) => setProof(event.target.value.trim())}
              className="w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 font-mono text-xs text-frost"
            />
            <button
              type="submit"
              disabled={busy || revealedRaw === undefined || !isHex(proof)}
              className="h-11 w-full rounded-2xl border border-white/15 text-sm text-frost disabled:opacity-40"
            >
              Claim liquidity
            </button>
          </form>
        ) : null}
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={chainId} />
      </section>
    </main>
  );
}
