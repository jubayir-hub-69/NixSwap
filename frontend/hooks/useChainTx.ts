"use client";

import { useState } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

function message(error: unknown) {
  if (error && typeof error === "object" && "shortMessage" in error) {
    const shortMessage = error.shortMessage;
    if (typeof shortMessage === "string" && shortMessage.length > 0) return shortMessage;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Transaction failed.";
}

export function useChainTx() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);

  async function submit(write: () => Promise<Hash>): Promise<TransactionReceipt> {
    if (!publicClient) throw new Error("No RPC client for this network.");
    setError(null);
    setPhase("Awaiting wallet signature");
    try {
      const tx = await write();
      setHash(tx);
      setPhase("Confirming on chain...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") throw new Error("Transaction reverted.");
      setPhase("Confirmed");
      return receipt;
    } catch (caught) {
      setPhase(null);
      const text = message(caught);
      setError(text);
      throw new Error(text);
    }
  }

  return {
    writeContractAsync,
    submit,
    setPhase,
    phase,
    error,
    hash,
    clear() {
      setPhase(null);
      setError(null);
      setHash(null);
    },
    fail(text: string) {
      setPhase(null);
      setError(text);
    },
    pending: phase === "Awaiting wallet signature" || phase === "Confirming on chain..." || Boolean(phase && phase !== "Confirmed" && !error),
  };
}
