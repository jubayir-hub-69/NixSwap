"use client";

import { useMemo } from "react";
import { useAccount, useReadContract } from "wagmi";
import { abis } from "@/config/contracts";
import { deploymentFor, optionalAddress } from "@/lib/deployment";
import { parseActiveLaunch, parseLaunches } from "@/lib/markets";

export function useLaunches() {
  const { address, chainId } = useAccount();
  const deployment = deploymentFor(chainId);
  const launchpad = optionalAddress(deployment, "NixLaunchpad");
  const all = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "allTokens",
    chainId,
    query: { enabled: Boolean(launchpad) },
  });
  const active = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "activeLaunchOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(launchpad && address) },
  });
  const rows = useMemo(() => parseLaunches(all.data), [all.data]);

  return {
    deployment,
    launchpad,
    chainId,
    address,
    rows,
    loading: Boolean(launchpad) && all.isLoading,
    error: all.error,
    active: parseActiveLaunch(active.data),
    async refetch() {
      await Promise.all([all.refetch(), active.refetch()]);
    },
  };
}
