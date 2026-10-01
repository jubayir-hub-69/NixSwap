"use client";

import { useMemo } from "react";
import { erc20Abi, type ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { liveReadQuery } from "@/lib/deployment";
import { figuresFromCalls, type MarketFigures } from "@/lib/markets";

const fields = [
  "reserveNix",
  "reserveToken",
  "priceX18",
  "markPriceX18",
  "previousPriceX18",
  "volumeWindowNix",
  "volumeNix",
] as const;

type PairRef = { pair: `0x${string}`; token: `0x${string}` };

/**
 * Reads each launched token's NixPair. Spot price is reserveNix × 1e18 / reserveToken.
 * Token balances held by the pair cover a reserve read that comes back empty.
 */
export function useMarketQuotes<T extends PairRef>(
  pairs: readonly T[],
  chainId: number | undefined,
  nix: `0x${string}` | undefined,
) {
  const contracts = useMemo(() => {
    if (!chainId || !nix) return [];
    const calls: (ContractFunctionParameters & { chainId: number })[] = [];
    pairs.forEach((pair) => {
      fields.forEach((functionName) => {
        calls.push({ address: pair.pair, abi: abis.NixPair, functionName, chainId });
      });
      calls.push({
        address: nix,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pair.pair],
        chainId,
      });
      calls.push({
        address: pair.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pair.pair],
        chainId,
      });
    });
    return calls;
  }, [chainId, nix, pairs]);

  const reads = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, ...liveReadQuery },
  });

  const quotes = useMemo(() => {
    return pairs.map((pair, index) => {
      const slice = reads.data?.slice(index * 9, (index + 1) * 9);
      const figures: MarketFigures = figuresFromCalls(slice);
      return { ...pair, ...figures };
    });
  }, [pairs, reads.data]);

  return { quotes, loading: reads.isLoading && reads.data === undefined, error: reads.error, refetch: reads.refetch };
}
