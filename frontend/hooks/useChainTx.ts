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
  const [phase, setPhaseState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");

  function setPhase(next: string) {
    setError(null);
    setStatus("pending");
    setPhaseState(next);
  }

  async function submit(write: () => Promise<Hash>): Promise<TransactionReceipt> {
    if (!publicClient) throw new Error("No RPC client for this network.");
    setError(null);
    setStatus("pending");
    setPhaseState("Awaiting Wallet Signature");
    try {
      const tx = await write();
      setHash(tx);
      setPhaseState("Confirming on chain...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") throw new Error("Transaction reverted.");
      setPhaseState("Confirmed");
      setStatus("success");
      return receipt;
    } catch (caught) {
      const text = message(caught);
      setPhaseState(null);
      setStatus("error");
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
      setStatus("idle");
      setPhaseState(null);
      setError(null);
      setHash(null);
    },
    succeed(text: string) {
      setStatus("success");
      setError(null);
      setPhaseState(text);
    },
    fail(text: string) {
      setStatus("error");
      setPhaseState(null);
      setError(text);
    },
    pending: status === "pending",
  };
}
