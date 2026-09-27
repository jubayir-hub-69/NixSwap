"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useBlock, useReadContract } from "wagmi";
import { abis } from "@/config/contracts";
import { useChainTx } from "@/hooks/useChainTx";
import { asBigint, formatUnits } from "@/lib/amount";
import { deploymentFor } from "@/lib/deployment";

export function FaucetButton() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const deployment = deploymentFor(chainId);
  const tx = useChainTx();
  const block = useBlock({ chainId, query: { enabled: Boolean(address && deployment) } });
  const drip = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "FAUCET_DRIP",
    chainId,
    query: { enabled: Boolean(deployment) },
  });
  const readyAt = useReadContract({
    address: deployment?.NixToken,
    abi: abis.NixToken,
    functionName: "faucetReadyAt",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(deployment && address) },
  });
  const next = asBigint(readyAt.data);
  const dripAmount = asBigint(drip.data);
  const dripLabel = dripAmount !== undefined ? `${formatUnits(dripAmount, 18, 0)} NIX` : "500 NIX";
  const now = block.data?.timestamp;
  const cooling = next !== undefined && now !== undefined && now < next;
  const label = tx.pending
    ? tx.phase?.includes("Confirming")
      ? "Confirming…"
      : "Signing…"
    : cooling
      ? "Faucet used"
      : dripLabel;

  async function claim() {
    if (!deployment || !chainId) return;
    tx.clear();
    try {
      await tx.submit(() =>
        tx.writeContractAsync({
          address: deployment.NixToken,
          abi: abis.NixToken,
          functionName: "claimFaucet",
          chainId,
        }),
      );
      await readyAt.refetch();
    } catch (error) {
      tx.fail(error instanceof Error ? error.message : "Faucet claim failed.");
    }
  }

  if (deployment && (drip.isError || (drip.isFetched && drip.data === undefined))) return null;

  return (
    <button
      type="button"
      data-testid="faucet-action"
      aria-busy={tx.pending}
      title={tx.error ?? (cooling ? "This wallet already claimed NIX today" : `Claim ${dripLabel}. One claim per address per day.`)}
      disabled={Boolean(isConnected && deployment && (tx.pending || cooling))}
      onClick={() => {
        if (!isConnected) openConnectModal?.();
        else void claim();
      }}
      className="inline-flex h-10 items-center rounded-full border border-cyan-glow/40 px-3 text-xs font-semibold text-cyan-glow disabled:opacity-40"
    >
      {label}
      <span className="sr-only">{tx.phase ?? tx.error ?? ""}</span>
    </button>
  );
}
