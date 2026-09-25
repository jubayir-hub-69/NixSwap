"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { isHex } from "viem";
import { useAccount, useBlock, useReadContract, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useFhenix } from "@/hooks/useFhenix";
import { asBigint, asNumber, formatUnits } from "@/lib/amount";
import { deployedChains, deploymentFor } from "@/lib/deployment";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 px-3 py-2">
      <p className="text-[11px] text-mist">{label}</p>
      <p className="mt-1 text-sm text-frost">{value}</p>
    </div>
  );
}

export function LaunchDesk() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { fhenixClient } = useFhenix();
  const tx = useChainTx();
  const deployment = deploymentFor(chainId);
  const block = useBlock({ chainId, query: { enabled: Boolean(deployment) } });
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [allocation, setAllocation] = useState("");
  const [allocationProof, setAllocationProof] = useState("");

  const launch = deployment?.NixLaunch;
  const biddingEnd = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "biddingEnd",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const tokensForSale = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "tokensForSale",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const basePrice = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "basePrice",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const curveStep = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "curveStep",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const settled = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "settled",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const finalized = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "finalized",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const bidders = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "bidderCount",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const paymentToken = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "paymentToken",
    chainId,
    query: { enabled: Boolean(launch) },
  });
  const allowance = useReadContract({
    address: paymentToken.data,
    abi: abis.NixToken,
    functionName: "allowance",
    args: address && launch ? [address, launch] : undefined,
    chainId,
    query: { enabled: Boolean(paymentToken.data && address && launch) },
  });
  const balance = useReadContract({
    address: paymentToken.data,
    abi: abis.NixToken,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(paymentToken.data && address) },
  });
  const decimals = useReadContract({
    address: paymentToken.data,
    abi: abis.NixToken,
    functionName: "decimals",
    chainId,
    query: { enabled: Boolean(paymentToken.data) },
  });
  const symbol = useReadContract({
    address: paymentToken.data,
    abi: abis.NixToken,
    functionName: "symbol",
    chainId,
    query: { enabled: Boolean(paymentToken.data) },
  });

  const places = asNumber(decimals.data);
  const amountRaw = /^\d+$/.test(amount) ? BigInt(amount) : amount === "" ? undefined : null;
  const limitRaw = /^\d+$/.test(limit) ? BigInt(limit) : limit === "" ? undefined : null;
  const end = asBigint(biddingEnd.data);
  const now = block.data?.timestamp;
  const open = end !== undefined && now !== undefined ? now < end : undefined;
  const revealedPrice = useReadContract({
    address: launch,
    abi: abis.NixLaunch,
    functionName: "clearingPrice",
    chainId,
    query: { enabled: Boolean(launch && finalized.data) },
  });
  const allocationRaw = /^\d+$/.test(allocation) ? BigInt(allocation) : undefined;
  const price = asBigint(revealedPrice.data);
  const payment = allocationRaw !== undefined && price !== undefined && price > 0n ? allocationRaw * price : undefined;
  const allowed = asBigint(allowance.data);
  const unit = typeof symbol.data === "string" ? symbol.data : "token";

  async function refresh() {
    await Promise.all([biddingEnd.refetch(), settled.refetch(), finalized.refetch(), bidders.refetch(), allowance.refetch(), balance.refetch()]);
  }

  async function submitBid() {
    if (!deployment || !chainId || !amountRaw || !limitRaw) return;
    tx.clear();
    try {
      tx.setPhase("Starting encryption");
      const encrypted = await fhenixClient.encryptUint64Pair(
        amountRaw,
        limitRaw,
        deployment.NixLaunch,
        tx.setPhase,
      );
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixLaunch,
          abi: abis.NixLaunch,
          functionName: "submitBid",
          args: [encrypted.first, encrypted.second, encrypted.inputProof],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  async function settle() {
    if (!deployment || !chainId) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixLaunch,
          abi: abis.NixLaunch,
          functionName: "settleLaunch",
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  async function claim() {
    if (!deployment || !chainId || !paymentToken.data || allocationRaw === undefined || payment === undefined || !isHex(allocationProof)) {
      return;
    }
    tx.clear();
    try {
      if (allowed !== undefined && allowed < payment) {
        await tx.submit(() =>
          tx.writeContractAsync({
            address: paymentToken.data,
            abi: abis.NixToken,
            functionName: "approve",
            args: [deployment.NixLaunch, payment],
            chainId,
          }),
        );
      }
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixLaunch,
          abi: abis.NixLaunch,
          functionName: "claim",
          args: [allocationRaw, allocationProof],
          chainId,
        }),
      );
      await refresh();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Transaction failed.");
    }
  }

  const busy = tx.pending || switching;
  const clearing = asBigint(basePrice.data);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Launch</h1>
        <p className="mt-1 text-xs text-mist">{deployment ? deployment.network : "Connect on a deployed testnet"}</p>
        <div className="mt-4 grid grid-cols-2 gap-2" data-testid="launch-stats">
          <Stat label="Tokens for sale" value={tokensForSale.data === undefined ? "Reading…" : String(tokensForSale.data)} />
          <Stat label="Base price" value={clearing === undefined ? "Reading…" : clearing.toString()} />
          <Stat label="Curve step" value={curveStep.data === undefined ? "Reading…" : String(curveStep.data)} />
          <Stat label="Bidders" value={bidders.data === undefined ? "Reading…" : String(bidders.data)} />
          <Stat
            label="Bidding ends"
            value={end === undefined ? "Reading…" : new Date(Number(end) * 1000).toLocaleString()}
          />
          <Stat
            label="Status"
            value={settled.data ? (finalized.data ? "Finalized" : "Settled") : open === false ? "Ready to settle" : "Bidding"}
          />
        </div>
      </section>

      <section className="glass-panel rounded-[28px] p-5">
        <p className="text-sm text-mist">
          Payment balance{" "}
          <span className="text-frost" data-testid="token-balance">
            {asBigint(balance.data) !== undefined && places
              ? `${formatUnits(asBigint(balance.data)!, places)} ${unit}`
              : "Connect to read"}
          </span>
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isConnected) openConnectModal?.();
            else if (!deployment) switchChain({ chainId: deployedChains[0].chainId });
            else void submitBid();
          }}
        >
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="text-xs text-mist">Bid size (uint64 units)</span>
            <input
              data-testid="bid-amount"
              value={amount}
              inputMode="numeric"
              placeholder="0"
              aria-label="Bid amount"
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
              className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
            />
          </label>
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="text-xs text-mist">Max unit price</span>
            <input
              data-testid="bid-limit"
              value={limit}
              inputMode="numeric"
              placeholder="0"
              aria-label="Max unit price"
              onChange={(event) => setLimit(event.target.value.replace(/\D/g, ""))}
              className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
            />
          </label>
          <button
            type="submit"
            data-testid="bid-action"
            disabled={Boolean(deployment) && (busy || open === false || !amountRaw || !limitRaw)}
            className="h-12 w-full rounded-2xl bg-cyan-glow text-sm font-semibold text-void disabled:opacity-40"
          >
            {!isConnected ? "Connect wallet" : !deployment ? "Switch network" : open === false ? "Bidding is closed" : tx.phase && tx.phase !== "Confirmed" ? tx.phase : "Encrypt and submit bid"}
          </button>
        </form>
        {open === false && settled.data === false ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void settle()}
            className="mt-3 h-11 w-full rounded-2xl border border-cyan-glow/40 text-sm font-semibold text-cyan-glow disabled:opacity-40"
          >
            Settle launch
          </button>
        ) : null}
        {finalized.data === true ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void claim();
            }}
          >
            <input
              value={allocation}
              inputMode="numeric"
              placeholder="Decrypted allocation"
              aria-label="Decrypted allocation"
              onChange={(event) => setAllocation(event.target.value.replace(/\D/g, ""))}
              className="w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost"
            />
            <input
              value={allocationProof}
              placeholder="Allocation proof hex"
              aria-label="Allocation proof"
              onChange={(event) => setAllocationProof(event.target.value.trim())}
              className="w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 font-mono text-xs text-frost"
            />
            <button
              type="submit"
              disabled={busy || allocationRaw === undefined || !isHex(allocationProof)}
              className="h-11 w-full rounded-2xl border border-white/15 text-sm text-frost disabled:opacity-40"
            >
              {allowed !== undefined && payment !== undefined && allowed < payment ? "Approve and claim" : "Claim allocation"}
            </button>
          </form>
        ) : null}
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={chainId} />
      </section>
    </main>
  );
}
