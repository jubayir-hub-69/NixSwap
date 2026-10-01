"use client";

import { useEffect } from "react";
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
  const value = asBigint(balance.data);
  const error = enabled && value === undefined && balance.isError;
  const loading = enabled && value === undefined && !balance.isError && balance.isFetching;
  const refetch = balance.refetch;

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => {
      void refetch({ cancelRefetch: true });
    }, 12_000);
    return () => clearInterval(timer);
  }, [loading, refetch]);

  return {
    value,
    decimals: asNumber(decimals.data) ?? 18,
    loading,
    error,
    refetch,
  };
}
