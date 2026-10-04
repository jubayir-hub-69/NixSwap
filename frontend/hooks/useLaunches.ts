"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useWatchContractEvent } from "wagmi";
import { abis } from "@/config/contracts";
import { deploymentFor, liveReadQuery, optionalAddress, readChainId } from "@/lib/deployment";
import { useTokenLogos } from "@/hooks/useTokenLogos";
import { parseActiveLaunch, parseLaunch, parseLaunches, type LaunchRow } from "@/lib/markets";

function subscribeHydration() {
  return () => {};
}

/** False during server render and hydration, then true. Keeps the first chain read off the server snapshot. */
function useHydrated() {
  return useSyncExternalStore(subscribeHydration, () => true, () => false);
}

export function useLaunches() {
  const account = useAccount();
  const fallbackChainId = useChainId();
  const ready = useHydrated();
  const chainId = ready ? readChainId(account.chainId, fallbackChainId) : undefined;
  const deployment = deploymentFor(chainId);
  const launchpad = optionalAddress(deployment, "NixLaunchpad");
  const enabled = Boolean(launchpad && chainId);

  const countQuery = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "tokenCount",
    chainId,
    query: { enabled, ...liveReadQuery },
  });
  const allQuery = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "allTokens",
    chainId,
    query: { enabled, ...liveReadQuery },
  });
  const count = typeof countQuery.data === "bigint" ? countQuery.data : undefined;
  const allRows = useMemo(
    () => (allQuery.isSuccess ? parseLaunches(allQuery.data) : []),
    [allQuery.data, allQuery.isSuccess],
  );
  const infoNeeded = count !== undefined && count > 0n && count <= 200n && allRows.length !== Number(count);
  const infoContracts = useMemo(() => {
    if (!launchpad || !chainId || !infoNeeded || count === undefined) return [];
    return Array.from({ length: Number(count) }, (_, id) => ({
      address: launchpad,
      abi: abis.NixLaunchpad,
      functionName: "tokenInfo" as const,
      args: [BigInt(id)] as const,
      chainId,
    }));
  }, [chainId, count, infoNeeded, launchpad]);
  const infoQuery = useReadContracts({
    contracts: infoContracts,
    query: { enabled: infoContracts.length > 0, ...liveReadQuery },
  });
  const infoRows = useMemo(() => {
    const rows: LaunchRow[] = [];
    infoQuery.data?.forEach((item, index) => {
      if (item.status !== "success") return;
      const row = parseLaunch(item.result, index);
      if (row) rows.push(row);
    });
    return rows;
  }, [infoQuery.data]);
  const rows = allRows.length > 0 ? allRows : infoRows;
  const logoTokens = useMemo(() => rows.map((row) => row.token), [rows]);
  const logoBook = useTokenLogos(launchpad, logoTokens, chainId);
  const listed = useMemo(
    () => rows.map((row) => ({ ...row, logoURI: logoBook.logos.get(row.token.toLowerCase()) ?? row.logoURI ?? "" })),
    [logoBook.logos, rows],
  );

  const activeQuery = useReadContract({
    address: launchpad,
    abi: abis.NixLaunchpad,
    functionName: "activeLaunchOf",
    args: account.address ? [account.address] : undefined,
    chainId,
    query: { enabled: Boolean(launchpad && account.address && chainId), ...liveReadQuery },
  });

  function refreshLaunches() {
    void Promise.all([countQuery.refetch(), allQuery.refetch(), infoQuery.refetch()]);
  }

  useWatchContractEvent({
    address: launchpad,
    abi: abis.NixLaunchpad,
    eventName: "TokenLaunched",
    chainId,
    enabled: Boolean(launchpad && chainId),
    onLogs: refreshLaunches,
  });
  useWatchContractEvent({
    address: launchpad,
    abi: abis.NixLaunchpad,
    eventName: "RemoteLaunchSeeded",
    chainId,
    enabled: Boolean(launchpad && chainId),
    onLogs: refreshLaunches,
  });

  const countPending = enabled && count === undefined && !countQuery.isError && rows.length === 0;
  const waitingForRows =
    count !== undefined &&
    count > 0n &&
    rows.length === 0 &&
    !allQuery.isError &&
    !(infoNeeded && (infoQuery.isSuccess || infoQuery.isError));
  const loading =
    !ready ||
    countPending ||
    (waitingForRows && (!allQuery.isFetched || allQuery.isFetching || infoQuery.isLoading || infoQuery.isFetching));
  const error = rows.length > 0 ? null : (countQuery.error ?? allQuery.error ?? infoQuery.error ?? null);

  return {
    deployment,
    launchpad,
    chainId,
    address: account.address,
    rows: listed,
    count,
    loading,
    error,
    active: parseActiveLaunch(activeQuery.data),
    async refetch() {
      await Promise.all([
        countQuery.refetch(),
        allQuery.refetch(),
        infoQuery.refetch(),
        activeQuery.refetch(),
        logoBook.refetch(),
      ]);
    },
  };
}
