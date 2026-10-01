"use client";

import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { asNumber } from "@/lib/amount";
import { bridgeChain } from "@/lib/bridge";
import { errorText } from "@/lib/deployment";
import { isWalletProvider, switchWalletChain } from "@/lib/walletChain";

export function AddToWalletButton({
  token,
  chainId,
  className,
}: {
  token: `0x${string}`;
  chainId: number | undefined;
  className?: string;
}) {
  const { chainId: connectedChainId, connector, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onNetwork = Boolean(isConnected && chainId !== undefined && connectedChainId === chainId);
  const network = bridgeChain(chainId)?.name;

  async function add() {
    if (!chainId || !publicClient) return;
    if (!isConnected || !connector) {
      setMessage(network ? `Connect a wallet on ${network}, then add the token.` : "Connect a wallet, then add the token.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const provider = await connector.getProvider();
      if (!isWalletProvider(provider)) throw new Error("This wallet cannot add a token.");
      if (connectedChainId !== chainId) await switchWalletChain(provider, chainId);
      const [symbol, decimals] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      const parsed = asNumber(decimals);
      if (typeof symbol !== "string" || symbol.trim() === "" || parsed === undefined) {
        throw new Error("The token contract did not return a symbol and decimals.");
      }
      const result = await provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: token, symbol: symbol.trim(), decimals: parsed } },
      });
      const didAdd = result !== false;
      setAdded(didAdd);
      setMessage(didAdd ? null : "The wallet did not add the token.");
    } catch (error) {
      setAdded(false);
      setMessage(errorText(error));
    } finally {
      setPending(false);
    }
  }

  const idle = added ? "Added" : onNetwork || !isConnected ? "Add to wallet" : "Switch to add";

  return (
    <span className="inline-flex max-w-full flex-col items-start">
      <button
        type="button"
        onClick={() => void add()}
        disabled={pending || !chainId}
        className={className ?? "text-xs text-cyan-glow disabled:opacity-40"}
      >
        {pending ? (onNetwork ? "Adding…" : "Switching…") : idle}
      </button>
      {message ? <span className="mt-1 max-w-48 text-[11px] leading-4 text-rose-300">{message}</span> : null}
    </span>
  );
}
