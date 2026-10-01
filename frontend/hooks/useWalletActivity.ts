"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, getAddress, http, parseAbiItem, type AbiEvent, type Address, type PublicClient } from "viem";
import { abis } from "@/config/contracts";
import { baseSepoliaChain, ethereumSepoliaChain, arbitrumSepoliaChain, transports } from "@/config/chains";
import { classifyReceipt, tokenAddressesIn, type ActivityDraft, type TokenMeta } from "@/lib/activity";
import { bridgeChains, configOf } from "@/lib/bridge";
import { deploymentFor, transactionUrl } from "@/lib/deployment";
import { parseLaunches } from "@/lib/markets";

const CHAINS = [arbitrumSepoliaChain, baseSepoliaChain, ethereumSepoliaChain] as const;
const CHUNK = 40_000n;
const MAX_CHUNKS = 25;
const PER_CHAIN = 30;

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const liquidityAdded = parseAbiItem(
  "event LiquidityAdded(address indexed provider, uint256 nixAmount, uint256 tokenAmount, uint256 shares, uint256 priceX18)",
);
const liquidityRemoved = parseAbiItem(
  "event LiquidityRemoved(address indexed provider, uint256 nixAmount, uint256 tokenAmount, uint256 shares, uint256 priceX18)",
);
const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 priceX18)",
);
const swapFilled = parseAbiItem(
  "event SwapFilled(uint256 indexed intentId, address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
);
const intentSubmitted = parseAbiItem(
  "event IntentSubmitted(uint256 indexed intentId, address indexed user, uint8 intentType, address solver, uint64 expiresAt)",
);
const tokenLaunched = parseAbiItem(
  "event TokenLaunched(uint256 indexed id, address indexed creator, address token, address pair)",
);

export type WalletActivity = ActivityDraft & {
  id: string;
  chainId: number;
  network: string;
  hash: `0x${string}`;
  timestamp: number | null;
  url?: string;
};

type Hit = { hash: `0x${string}`; blockNumber: bigint };

function clientFor(chainId: number) {
  const chain = CHAINS.find((item) => item.id === chainId);
  const url = transports[chainId as keyof typeof transports];
  if (!chain || !url) return undefined;
  return createPublicClient({ chain, transport: http(url) });
}

function isRangeError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /range|block range|too many|exceed|limit|timeout|more than|query returned more|header not found/i.test(text);
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
  const registry =
    deployment?.IntentRegistry && /^0x[0-9a-fA-F]{40}$/.test(deployment.IntentRegistry)
      ? getAddress(deployment.IntentRegistry)
      : undefined;
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
      // The chain still contributes NIX transfers when the launch list cannot be read.
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
      // Bridge tokens are optional. Known launch tokens are still scanned.
    }
  }

  await Promise.all(
    tokens.map(async (token) => {
      const meta = await readMeta(client, token);
      if (meta) symbols.set(token.toLowerCase(), meta);
    }),
  );

  return { tokens, pairs, symbols, launchpad, bridge, registry };
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

async function pull(
  client: PublicClient,
  address: Address | Address[],
  event: AbiEvent,
  args: Record<string, unknown> | undefined,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Hit[]> {
  if (Array.isArray(address) && address.length === 0) return [];
  try {
    const logs = await client.getLogs({ address, event, args, fromBlock, toBlock } as Parameters<PublicClient["getLogs"]>[0]);
    return logs.flatMap((log) =>
      log.transactionHash && log.blockNumber !== null ? [{ hash: log.transactionHash, blockNumber: log.blockNumber }] : [],
    );
  } catch (error) {
    if (!isRangeError(error) || toBlock - fromBlock < 1_000n) throw error;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const left = await pull(client, address, event, args, fromBlock, mid);
    const right = await pull(client, address, event, args, mid + 1n, toBlock);
    return [...left, ...right];
  }
}

async function scanChain(client: PublicClient, chainId: number, user: Address) {
  const discovered = await discover(client, chainId);
  const latest = await client.getBlockNumber();
  const found = new Map<string, Hit>();
  let to = latest;
  for (let chunk = 0; chunk < MAX_CHUNKS && found.size < PER_CHAIN; chunk += 1) {
    const from = to > CHUNK ? to - CHUNK + 1n : 0n;
    const queries: Promise<Hit[]>[] = [];
    if (discovered.tokens.length > 0) {
      queries.push(pull(client, discovered.tokens, transferEvent, { from: user }, from, to));
      queries.push(pull(client, discovered.tokens, transferEvent, { to: user }, from, to));
    }
    const pairAddresses = [...discovered.pairs.keys()].map((item) => getAddress(item));
    if (pairAddresses.length > 0) {
      queries.push(pull(client, pairAddresses, liquidityAdded, { provider: user }, from, to));
      queries.push(pull(client, pairAddresses, liquidityRemoved, { provider: user }, from, to));
      queries.push(pull(client, pairAddresses, swapEvent, { recipient: user }, from, to));
      queries.push(pull(client, pairAddresses, swapEvent, { sender: user }, from, to));
    }
    if (discovered.launchpad) {
      queries.push(pull(client, discovered.launchpad, tokenLaunched, { creator: user }, from, to));
    }
    if (discovered.registry) {
      queries.push(pull(client, discovered.registry, swapFilled, { user }, from, to));
      queries.push(pull(client, discovered.registry, intentSubmitted, { user }, from, to));
    }
    if (queries.length === 0) break;
    const batches = await Promise.all(queries);
    for (const hit of batches.flat()) found.set(hit.hash, hit);
    if (from === 0n) break;
    to = from - 1n;
  }
  return { hits: [...found.values()], discovered };
}

async function loadChain(chainId: number, network: string, user: Address): Promise<{ rows: WalletActivity[]; warning?: string }> {
  const client = clientFor(chainId);
  if (!client) return { rows: [], warning: `${network} has no RPC configured.` };
  try {
    const scanned = await scanChain(client, chainId, user);
    const stamped = await Promise.all(
      scanned.hits.map(async (hit) => {
        try {
          const block = await client.getBlock({ blockNumber: hit.blockNumber });
          return { ...hit, timestamp: Number(block.timestamp) };
        } catch {
          return { ...hit, timestamp: null as number | null };
        }
      }),
    );
    stamped.sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0));
    const chosen = stamped.slice(0, PER_CHAIN);
    const rows: WalletActivity[] = [];
    for (const hit of chosen) {
      const receipt = await client.getTransactionReceipt({ hash: hit.hash });
      const logs = receipt.logs.flatMap((log) =>
        log.topics.length > 0 ? [{ address: log.address, data: log.data, topics: log.topics }] : [],
      );
      const missing = tokenAddressesIn(logs).filter((token) => !scanned.discovered.symbols.has(token));
      await Promise.all(
        missing.map(async (token) => {
          const meta = await readMeta(client, getAddress(token));
          if (meta) scanned.discovered.symbols.set(token, meta);
        }),
      );
      const draft = classifyReceipt(logs, {
        user,
        symbols: scanned.discovered.symbols,
        pairs: scanned.discovered.pairs,
      });
      if (!draft) continue;
      rows.push({
        ...draft,
        id: `${chainId}:${hit.hash}`,
        chainId,
        network,
        hash: hit.hash,
        timestamp: hit.timestamp,
        url: transactionUrl(chainId, hit.hash),
      });
    }
    return { rows };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "The RPC request failed.";
    return { rows: [], warning: `${network} activity could not be read. ${message}` };
  }
}

export function useWalletActivity(user: Address | undefined) {
  const account = user ? getAddress(user) : null;
  const query = useQuery({
    queryKey: ["wallet-activity", account],
    enabled: account !== null,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async ({ queryKey }) => {
      const current = queryKey[1];
      if (typeof current !== "string") return { rows: [], warnings: [] as string[] };
      const results = await Promise.all(
        bridgeChains.map((chain) => loadChain(chain.chainId, chain.name, getAddress(current))),
      );
      return {
        rows: results
          .flatMap((result) => result.rows)
          .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))
          .slice(0, 20),
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
    refreshing: Boolean(account) && query.isFetching,
    reload() {
      void query.refetch();
    },
  } as const;
}
