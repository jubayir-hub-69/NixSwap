"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, getAddress, http, type Address, type PublicClient } from "viem";
import { abis } from "@/config/contracts";
import { arbitrumSepoliaChain, baseSepoliaChain, ethereumSepoliaChain, transports } from "@/config/chains";
import {
  classifyReceipt,
  tokenAddressesIn,
  type ActivityDraft,
  type ActivityKind,
  type TokenMeta,
} from "@/lib/activity";
import { bridgeChains, configOf } from "@/lib/bridge";
import { deploymentFor, transactionUrl } from "@/lib/deployment";
import { parseLaunches } from "@/lib/markets";

const CHAINS = [arbitrumSepoliaChain, baseSepoliaChain, ethereumSepoliaChain] as const;
const PER_CHAIN = 30;

const EXPLORERS: Record<number, string> = {
  421614: "https://arbitrum-sepolia.blockscout.com",
  84532: "https://base-sepolia.blockscout.com",
  11155111: "https://eth-sepolia.blockscout.com",
};

export type WalletActivity = ActivityDraft & {
  id: string;
  chainId: number;
  network: string;
  hash: `0x${string}`;
  timestamp: number | null;
  url?: string;
  reverted: boolean;
};

type IndexedTx = {
  hash: `0x${string}`;
  timestamp: number | null;
  reverted: boolean;
  method: string | null;
};

function clientFor(chainId: number) {
  const chain = CHAINS.find((item) => item.id === chainId);
  const url = transports[chainId as keyof typeof transports];
  if (!chain || !url) return undefined;
  return createPublicClient({ chain, transport: http(url) });
}

function pushToken(list: Address[], token: string | undefined) {
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) return;
  const checksum = getAddress(token);
  if (list.some((item) => item.toLowerCase() === checksum.toLowerCase())) return;
  list.push(checksum);
}

async function discover(client: PublicClient, chainId: number) {
  const deployment = deploymentFor(chainId);
  const tokens: Address[] = [];
  const pairs = new Map<string, { nix: Address; token: Address }>();
  const symbols = new Map<string, TokenMeta>();
  const nix = deployment?.NixToken && /^0x[0-9a-fA-F]{40}$/.test(deployment.NixToken) ? getAddress(deployment.NixToken) : undefined;
  const launchpad =
    deployment?.NixLaunchpad && /^0x[0-9a-fA-F]{40}$/.test(deployment.NixLaunchpad)
      ? getAddress(deployment.NixLaunchpad)
      : undefined;
  const bridge =
    deployment?.NixBridge && /^0x[0-9a-fA-F]{40}$/.test(deployment.NixBridge) ? getAddress(deployment.NixBridge) : undefined;
  if (nix) pushToken(tokens, nix);

  if (launchpad) {
    try {
      const listed = await client.readContract({ address: launchpad, abi: abis.NixLaunchpad, functionName: "allTokens" });
      for (const row of parseLaunches(listed)) {
        pushToken(tokens, row.token);
        if (nix) pairs.set(row.pair.toLowerCase(), { nix, token: getAddress(row.token) });
        symbols.set(row.token.toLowerCase(), { symbol: row.symbol, decimals: 18 });
      }
    } catch {
      // NIX transfers can still be labeled when the launch list cannot be read.
    }
  }

  if (bridge) {
    try {
      const count = await client.readContract({ address: bridge, abi: abis.NixBridge, functionName: "tokenCount" });
      const total = typeof count === "bigint" && count <= 32n ? Number(count) : 0;
      for (let index = 0; index < total; index += 1) {
        const tokenId = await client.readContract({
          address: bridge,
          abi: abis.NixBridge,
          functionName: "tokenIdAt",
          args: [BigInt(index)],
        });
        if (typeof tokenId !== "string") continue;
        const config = configOf(
          await client.readContract({
            address: bridge,
            abi: abis.NixBridge,
            functionName: "tokenConfig",
            args: [tokenId as `0x${string}`],
          }),
        );
        if (config?.enabled) pushToken(tokens, config.token);
      }
    } catch {
      // Bridge tokens are optional. Known launch tokens are still labeled.
    }
  }

  await Promise.all(
    tokens.map(async (token) => {
      const meta = await readMeta(client, token);
      if (meta) symbols.set(token.toLowerCase(), meta);
    }),
  );

  return { pairs, symbols };
}

async function readMeta(client: PublicClient, token: Address): Promise<TokenMeta | undefined> {
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const parsed = typeof decimals === "bigint" ? Number(decimals) : decimals;
    if (typeof symbol !== "string" || symbol.trim() === "" || !Number.isInteger(parsed)) return undefined;
    return { symbol: symbol.trim(), decimals: parsed };
  } catch {
    return undefined;
  }
}

function asItems(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || !("items" in value)) return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => (item && typeof item === "object" ? [item as Record<string, unknown>] : []));
}

function readHash(value: unknown): `0x${string}` | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : undefined;
}

function readTime(value: unknown) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function methodName(method: string | null) {
  return (method ?? "").split("(")[0].replace(/^0x/, "").toLowerCase();
}

function isNoise(method: string | null, types: string[]) {
  const name = methodName(method);
  if (name === "approve" || name === "095ea7b3") return true;
  if (!method && types.length === 1 && types[0] === "coin_transfer") return true;
  return false;
}

function kindFromMethod(method: string | null): ActivityKind | undefined {
  switch (methodName(method)) {
    case "removeliquidity":
    case "9c8f9f23":
      return "Remove liquidity";
    case "addliquidity":
    case "9cd441da":
      return "Add liquidity";
    case "createtoken":
    case "5b060530":
    case "relay":
    case "be0d56d2":
    case "finalizeremote":
    case "59eb1b30":
    case "retire":
    case "3790cf57":
      return "Launch";
    case "submitswapintent":
    case "d0a7b1fa":
    case "submitintent":
    case "abbe57d9":
    case "fillswap":
    case "swap":
      return "Swap";
    case "send":
    case "e67f17fb":
    case "fb9260cf":
      return "Bridge";
    case "claimfaucet":
    case "4fe15335":
      return "Receive";
    case "deposit":
    case "1de26e16":
      return "Escrow deposit";
    case "transfer":
    case "a9059cbb":
      return "Send";
    default:
      return undefined;
  }
}

const EXPLORER_PAGES = 3;

function pageQuery(value: unknown) {
  if (!value || typeof value !== "object" || !("next_page_params" in value)) return "";
  const params = (value as { next_page_params?: unknown }).next_page_params;
  if (!params || typeof params !== "object") return "";
  const search = new URLSearchParams();
  for (const [key, entry] of Object.entries(params)) {
    if (typeof entry === "string" || typeof entry === "number") search.set(key, String(entry));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function explorerItems(url: string) {
  const collected: Record<string, unknown>[] = [];
  let next = url;
  for (let page = 0; page < EXPLORER_PAGES && next; page += 1) {
    const response = await fetch(next);
    if (!response.ok) {
      if (page === 0) throw new Error(`Explorer returned ${response.status}.`);
      break;
    }
    const payload: unknown = await response.json();
    collected.push(...asItems(payload));
    const query = pageQuery(payload);
    next = query ? `${url.split("?")[0]}${query}` : "";
  }
  return collected;
}

function transferHash(item: Record<string, unknown>) {
  const nested = item.transaction;
  const nestedHash =
    nested && typeof nested === "object" ? readHash((nested as Record<string, unknown>).hash) : undefined;
  return readHash(item.transaction_hash) ?? readHash(item.tx_hash) ?? nestedHash;
}

async function indexedTransactions(chainId: number, user: Address): Promise<IndexedTx[]> {
  const base = EXPLORERS[chainId];
  if (!base) throw new Error("No explorer is configured.");
  const [txs, transfers] = await Promise.all([
    explorerItems(`${base}/api/v2/addresses/${user}/transactions`),
    explorerItems(`${base}/api/v2/addresses/${user}/token-transfers`).catch(() => [] as Record<string, unknown>[]),
  ]);
  const transferHashes = new Set<string>();
  for (const item of transfers) {
    const hash = transferHash(item);
    if (hash) transferHashes.add(hash.toLowerCase());
  }
  const byHash = new Map<string, IndexedTx>();
  for (const item of txs) {
    const hash = readHash(item.hash);
    if (!hash) continue;
    const method = typeof item.method === "string" ? item.method : null;
    const types = Array.isArray(item.transaction_types)
      ? item.transaction_types.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (!transferHashes.has(hash.toLowerCase()) && isNoise(method, types)) continue;
    byHash.set(hash.toLowerCase(), {
      hash,
      timestamp: readTime(item.timestamp),
      reverted: item.status === "error",
      method,
    });
  }
  for (const item of transfers) {
    const hash = transferHash(item);
    if (!hash || byHash.has(hash.toLowerCase())) continue;
    byHash.set(hash.toLowerCase(), {
      hash,
      timestamp: readTime(item.timestamp),
      reverted: false,
      method: typeof item.method === "string" ? item.method : null,
    });
  }
  return [...byHash.values()].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)).slice(0, PER_CHAIN);
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function loadChain(chainId: number, network: string, user: Address): Promise<{ rows: WalletActivity[]; warning?: string }> {
  const client = clientFor(chainId);
  if (!client) return { rows: [], warning: `${network} has no RPC configured.` };
  try {
    const [indexed, discovered] = await Promise.all([indexedTransactions(chainId, user), discover(client, chainId)]);
    const rows = await mapPool(indexed, 4, async (hit) => {
      let draft: ActivityDraft | undefined;
      let reverted = hit.reverted;
      try {
        const receipt = await client.getTransactionReceipt({ hash: hit.hash });
        reverted = reverted || receipt.status === "reverted";
        const logs = receipt.logs.flatMap((log) =>
          log.topics.length > 0 ? [{ address: log.address, data: log.data, topics: log.topics }] : [],
        );
        const missing = tokenAddressesIn(logs).filter((token) => !discovered.symbols.has(token));
        await Promise.all(
          missing.map(async (token) => {
            const meta = await readMeta(client, getAddress(token));
            if (meta) discovered.symbols.set(token, meta);
          }),
        );
        draft = classifyReceipt(logs, { user, symbols: discovered.symbols, pairs: discovered.pairs });
      } catch {
        draft = undefined;
      }
      if (!draft) {
        const kind = kindFromMethod(hit.method);
        if (!kind) return undefined;
        draft = {
          kind,
          amountLabel: reverted ? "Reverted" : "Amount unavailable",
          detail: reverted ? "The transaction reverted before tokens moved." : "Confirmed on this network.",
        };
      } else if (reverted) {
        draft = { ...draft, detail: "The transaction reverted before tokens moved." };
      }
      const row: WalletActivity = {
        ...draft,
        id: `${chainId}:${hit.hash}`,
        chainId,
        network,
        hash: hit.hash,
        timestamp: hit.timestamp,
        url: transactionUrl(chainId, hit.hash),
        reverted,
      };
      return row;
    });
    return { rows: rows.flatMap((row) => (row ? [row] : [])) };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "The activity request failed.";
    return { rows: [], warning: `${network} activity could not be read. ${message}` };
  }
}

type ActivityResult = { rows: WalletActivity[]; warnings: string[] };

export function useWalletActivity(user: Address | undefined) {
  const account = user ? getAddress(user) : null;
  const query = useQuery<ActivityResult>({
    queryKey: ["wallet-activity", account],
    enabled: account !== null,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
    queryFn: async ({ queryKey }): Promise<ActivityResult> => {
      const current = queryKey[1];
      if (typeof current !== "string") return { rows: [], warnings: [] as string[] };
      const results = await Promise.all(
        bridgeChains.map((chain) => loadChain(chain.chainId, chain.name, getAddress(current))),
      );
      return {
        rows: results
          .flatMap((result) => result.rows)
          .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)),
        warnings: results.flatMap((result) => (result.warning ? [result.warning] : [])),
      };
    },
  });

  const warnings = account
    ? [
        ...(query.data?.warnings ?? []),
        ...(query.isError
          ? [query.error instanceof Error ? query.error.message.split("\n")[0] : "Recent transactions could not be read."]
          : []),
      ]
    : [];

  return {
    rows: account ? (query.data?.rows ?? []) : [],
    warnings,
    status: !account ? "idle" : query.isPending ? "loading" : "ready",
    refreshing: Boolean(account) && query.isFetching && !query.isPending,
    reload() {
      void query.refetch();
    },
  } as const;
}
