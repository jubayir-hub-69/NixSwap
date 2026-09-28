"use client";

import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { asBigint, asNumber } from "@/lib/amount";
import { liveReadQuery } from "@/lib/deployment";

export function useErc20Balance(
  token: `0x${string}` | undefined,
  account: `0x${string}` | undefined,
  chainId: number | undefined,
) {
  const enabled = Boolean(token && account && chainId);
  const balance = useReadContract({
    abi: erc20Abi,
    address: token,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled, ...liveReadQuery },
  });
  const decimals = useReadContract({
    abi: erc20Abi,
    address: token,
    functionName: "decimals",
    chainId,
    query: { enabled: Boolean(token && chainId), staleTime: 60_000 },
  });

  return {
    value: asBigint(balance.data),
    decimals: asNumber(decimals.data) ?? 18,
    loading: enabled && balance.isLoading,
    error: Boolean(balance.error),
    refetch: balance.refetch,
  };
}
