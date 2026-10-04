"use client";

import { useMemo } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { asBigint, asNumber } from "@/lib/amount";
import { configOf } from "@/lib/bridge";
import { deploymentFor, liveReadQuery, optionalAddress } from "@/lib/deployment";
import { useTokenLogos } from "@/hooks/useTokenLogos";
import { parseLaunches } from "@/lib/markets";

export type Holding = {
  address: `0x${string}`;
  symbol?: string;
  name?: string;
  decimals?: number;
  balance?: bigint;
  /** On-chain logo link from the launchpad. Absent for NIX and for tokens launched without one. */
  logoURI?: string;
  loading: boolean;
  error: boolean;
};

function pushToken(list: `0x${string}`[], token: string | undefined) {
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) return;
  if (list.some((item) => item.toLowerCase() === token.toLowerCase())) return;
  list.push(token as `0x${string}`);
}

/** Live wallet balances for NIX, bridge-registered tokens, and launchpad tokens on one chain. */
export function useChainHoldings(chainId: number) {
  const { address: wallet } = useAccount();
  const deployment = deploymentFor(chainId);
  const launchpad = optionalAddress(deployment, "NixLaunchpad");
  const nix = optionalAddress(deployment, "NixToken");
  const bridge = optionalAddress(deployment, "NixBridge");

  const launches = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "allTokens",
    chainId,
    query: { enabled: Boolean(launchpad), ...liveReadQuery },
  });
  const rows = useMemo(() => (launches.isSuccess ? parseLaunches(launches.data) : []), [launches.data, launches.isSuccess]);
  const logoTokens = useMemo(() => rows.map((row) => row.token), [rows]);
  const logoBook = useTokenLogos(launchpad, logoTokens, chainId);

  const tokenCount = useReadContract({
    address: bridge,
    abi: abis.NixBridge,
    functionName: "tokenCount",
    chainId,
    query: { enabled: Boolean(bridge), ...liveReadQuery },
  });
  const counted = typeof tokenCount.data === "bigint" ? tokenCount.data : undefined;
  const listedCount = counted !== undefined && counted <= 32n ? Number(counted) : 0;
  const idQuery = useReadContracts({
    contracts: Array.from({ length: listedCount }, (_, index) => ({
      address: bridge!,
      abi: abis.NixBridge,
      functionName: "tokenIdAt" as const,
      args: [BigInt(index)] as const,
      chainId,
    })),
    query: { enabled: Boolean(bridge && listedCount > 0), ...liveReadQuery },
  });
  const tokenIds = useMemo(() => {
    const ids: `0x${string}`[] = [];
    for (const row of idQuery.data ?? []) {
      if (row.status === "success" && typeof row.result === "string" && /^0x[0-9a-fA-F]{64}$/.test(row.result)) {
        ids.push(row.result as `0x${string}`);
      }
    }
    return ids;
  }, [idQuery.data]);
  const configQuery = useReadContracts({
    contracts: tokenIds.map((tokenId) => ({
      address: bridge!,
      abi: abis.NixBridge,
      functionName: "tokenConfig" as const,
      args: [tokenId] as const,
      chainId,
    })),
    query: { enabled: Boolean(bridge && tokenIds.length > 0), ...liveReadQuery },
  });
  const bridgeTokens = useMemo(() => {
    const tokens: `0x${string}`[] = [];
    configQuery.data?.forEach((row) => {
      if (row.status !== "success") return;
      const config = configOf(row.result);
      if (config?.enabled) pushToken(tokens, config.token);
    });
    return tokens;
  }, [configQuery.data]);

  const assets = useMemo(() => {
    const list: `0x${string}`[] = [];
    pushToken(list, nix);
    rows.forEach((row) => pushToken(list, row.token));
    bridgeTokens.forEach((token) => pushToken(list, token));
    return list;
  }, [bridgeTokens, nix, rows]);

  const meta = useReadContracts({
    contracts: assets.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "name" as const, chainId },
      { address: token, abi: erc20Abi, functionName: "symbol" as const, chainId },
      { address: token, abi: erc20Abi, functionName: "decimals" as const, chainId },
    ]),
    query: { enabled: assets.length > 0, ...liveReadQuery },
  });
  const balances = useReadContracts({
    contracts: assets.map((token) => ({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: wallet ? ([wallet] as const) : undefined,
      chainId,
    })),
    query: { enabled: Boolean(wallet) && assets.length > 0, ...liveReadQuery },
  });

  const holdings: Holding[] = assets.map((token, index) => {
    const base = index * 3;
    const name = meta.data?.[base];
    const symbol = meta.data?.[base + 1];
    const decimals = meta.data?.[base + 2];
    const balance = balances.data?.[index];
    const failed = Boolean(
      meta.isError ||
        symbol?.status === "failure" ||
        decimals?.status === "failure" ||
        (wallet && (balances.isError || balance?.status === "failure")),
    );
    const metaWaiting = !failed && assets.length > 0 && (meta.isLoading || meta.data === undefined);
    const balanceWaiting = !failed && Boolean(wallet) && (balances.isLoading || balances.data === undefined);
    return {
      address: token,
      name: name?.status === "success" && typeof name.result === "string" ? name.result : undefined,
      symbol: symbol?.status === "success" && typeof symbol.result === "string" ? symbol.result.trim() : undefined,
      decimals: decimals?.status === "success" ? asNumber(decimals.result) : undefined,
      balance: balance?.status === "success" ? asBigint(balance.result) : undefined,
      logoURI: logoBook.logos.get(token.toLowerCase()),
      loading: (metaWaiting || balanceWaiting) && !failed,
      error: failed,
    };
  });

  const loading =
    (Boolean(launchpad) && launches.isLoading && rows.length === 0) ||
    (Boolean(bridge) && tokenCount.isLoading) ||
    (listedCount > 0 && (idQuery.isLoading || configQuery.isLoading)) ||
    (assets.length > 0 && meta.isLoading && !meta.data) ||
    (Boolean(wallet) && assets.length > 0 && balances.isLoading && !balances.data);

  return {
    chainId,
    network: deployment?.network,
    holdings,
    loading,
    launchError: launches.isError,
    bridgeError: tokenCount.isError,
    bridgeOverflow: counted !== undefined && counted > 32n,
    deployed: Boolean(deployment),
  };
}
