"use client";

import { useRef, useState } from "react";
import {
  TransactionReceiptNotFoundError,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

function message(error: unknown) {
  if (error instanceof TransactionReceiptNotFoundError) return "The transaction receipt was not found.";
  if (error && typeof error === "object" && "shortMessage" in error) {
    const shortMessage = error.shortMessage;
    if (typeof shortMessage === "string" && shortMessage.length > 0) return shortMessage;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Transaction failed.";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RPC timed out.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Poll the receipt directly. Each RPC call has its own deadline so a hung provider
 * cannot leave the button in a pending state after the wallet has already broadcast.
 */
async function waitForReceipt(client: PublicClient, hash: Hash, timeoutMs: number) {
  const started = Date.now();
  let lastError: unknown = new Error("Timed out waiting for the transaction receipt.");
  while (Date.now() - started < timeoutMs) {
    try {
      return await withTimeout(client.getTransactionReceipt({ hash }), 8_000);
    } catch (error) {
      lastError = error;
    }
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, remaining)));
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for the transaction receipt.");
}

export function useChainTx() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhaseState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const sealed = useRef(false);

  function setPhase(next: string) {
    if (sealed.current) return;
    setError(null);
    setStatus("pending");
    setPhaseState(next);
  }

  async function submit(write: () => Promise<Hash>): Promise<TransactionReceipt> {
    if (!publicClient) throw new Error("No RPC client for this network.");
    sealed.current = false;
    setError(null);
    setStatus("pending");
    setPhaseState("Awaiting Wallet Signature");
    try {
      const tx = await write();
      setHash(tx);
      setPhaseState("Confirming on chain...");
      const receipt = await waitForReceipt(publicClient, tx, 90_000);
      if (receipt.status === "reverted") throw new Error("Transaction reverted.");
      sealed.current = true;
      setPhaseState("Confirmed");
      setStatus("success");
      return receipt;
    } catch (caught) {
      const text = message(caught);
      sealed.current = true;
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
    status,
    clear() {
      sealed.current = false;
      setStatus("idle");
      setPhaseState(null);
      setError(null);
      setHash(null);
    },
    succeed(text: string) {
      sealed.current = true;
      setStatus("success");
      setError(null);
      setPhaseState(text);
    },
    fail(text: string) {
      sealed.current = true;
      setStatus("error");
      setPhaseState(null);
      setError(text);
    },
    pending: status === "pending",
  };
}
