"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { liveReadQuery } from "@/lib/deployment";

/** On-chain `tokenLogo` for each launch. A launchpad without that function leaves the map empty. */
export function useTokenLogos(
  launchpad: `0x${string}` | undefined,
  tokens: readonly `0x${string}`[],
  chainId: number | undefined,
) {
  const query = useReadContracts({
    contracts: tokens.map((token) => ({
      address: launchpad!,
      abi: abis.NixLaunchpad,
      functionName: "tokenLogo" as const,
      args: [token] as const,
      chainId,
    })),
    query: { enabled: Boolean(launchpad && chainId && tokens.length > 0), ...liveReadQuery },
  });
  const logos = useMemo(() => {
    const next = new Map<string, string>();
    query.data?.forEach((row, index) => {
      const token = tokens[index];
      if (!token || row.status !== "success" || typeof row.result !== "string" || row.result.length === 0) return;
      next.set(token.toLowerCase(), row.result);
    });
    return next;
  }, [query.data, tokens]);
  return { logos, refetch: query.refetch };
}
