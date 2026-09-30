"use client";

import { useState } from "react";
import { erc20Abi } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { asNumber } from "@/lib/amount";
import { errorText } from "@/lib/deployment";

export function AddToWalletButton({
  token,
  chainId,
  className,
}: {
  token: `0x${string}`;
  chainId: number | undefined;
  className?: string;
}) {
  const { data: wallet } = useWalletClient({ chainId });
  const publicClient = usePublicClient({ chainId });
  const [pending, setPending] = useState(false);
  const [label, setLabel] = useState("Add to wallet");
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    if (!chainId || !publicClient || !wallet) {
      setMessage("Connect a wallet on this network, then add the token.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const [symbol, decimals] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      const parsed = asNumber(decimals);
      if (typeof symbol !== "string" || symbol.trim() === "" || parsed === undefined) {
        throw new Error("The token contract did not return a symbol and decimals.");
      }
      const added = await wallet.watchAsset({
        type: "ERC20",
        options: { address: token, symbol: symbol.trim(), decimals: parsed },
      });
      setLabel(added ? "Added" : "Add to wallet");
      setMessage(added ? null : "The wallet did not add the token.");
    } catch (error) {
      setLabel("Add to wallet");
      setMessage(errorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex max-w-full flex-col items-start">
      <button
        type="button"
        onClick={() => void add()}
        disabled={pending || !chainId}
        className={className ?? "text-xs text-cyan-glow disabled:opacity-40"}
      >
        {pending ? "Adding…" : label}
      </button>
      {message ? <span className="mt-1 max-w-48 text-[11px] leading-4 text-rose-300">{message}</span> : null}
    </span>
  );
}
