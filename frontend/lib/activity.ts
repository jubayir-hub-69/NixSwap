import { decodeEventLog, type Address, type Hex, parseAbi } from "viem";
import { formatUnits } from "@/lib/amount";
import { bridgeChains } from "@/lib/bridge";
import { shortAddress } from "@/lib/markets";

export const activityEvents = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event OftSent(bytes32 indexed guid, uint32 indexed dstEid, uint64 nonce, address indexed sender, address recipient, uint256 amount)",
  "event OftReceived(bytes32 indexed guid, uint32 indexed srcEid, uint64 nonce, address recipient, uint256 amount)",
  "event BridgeSent(bytes32 indexed guid, uint32 indexed dstEid, bytes32 indexed tokenId, uint64 nonce, address sender, address recipient, uint256 amount, uint8 decimals)",
  "event BridgeReceived(bytes32 indexed guid, uint32 indexed srcEid, bytes32 indexed tokenId, uint64 nonce, address recipient, uint256 amount)",
  "event LiquidityDeposited(bytes32 indexed tokenId, address indexed from, uint256 amount)",
  "event LiquidityAdded(address indexed provider, uint256 nixAmount, uint256 tokenAmount, uint256 shares, uint256 priceX18)",
  "event LiquidityRemoved(address indexed provider, uint256 nixAmount, uint256 tokenAmount, uint256 shares, uint256 priceX18)",
  "event Swap(address indexed sender, address indexed recipient, address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 priceX18)",
  "event SwapFilled(uint256 indexed intentId, address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
  "event IntentSubmitted(uint256 indexed intentId, address indexed user, uint8 intentType, address solver, uint64 expiresAt)",
  "event TokenLaunched(uint256 indexed id, address indexed creator, address token, address pair)",
  "event LaunchSeeded(uint256 indexed id, uint256 creatorAmount, uint256 liquidityTokens, uint256 seedNix, uint256 priceX18)",
]);

export type ActivityKind =
  | "Send"
  | "Receive"
  | "Swap"
  | "Launch"
  | "Bridge"
  | "Add liquidity"
  | "Remove liquidity"
  | "Escrow deposit";

export type ActivityDraft = {
  kind: ActivityKind;
  amountLabel: string;
  detail: string;
};

export type TokenMeta = { symbol: string; decimals: number };

export type ActivityContext = {
  user: Address;
  symbols: Map<string, TokenMeta>;
  pairs: Map<string, { nix: Address; token: Address }>;
};

type Found = { eventName: string; address: Address; args: Record<string, unknown> };

const ZERO = "0x0000000000000000000000000000000000000000";

function same(left: string | undefined, right: string | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export function readAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined;
  return value as Address;
}

function readUint(value: unknown) {
  return typeof value === "bigint" ? value : undefined;
}

function readEid(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function eidName(eid: number | undefined) {
  if (eid === undefined) return "the other network";
  return bridgeChains.find((chain) => chain.eid === eid)?.name ?? `endpoint ${eid}`;
}

function money(symbols: Map<string, TokenMeta>, token: string | undefined, value: bigint | undefined) {
  if (!token || value === undefined) return undefined;
  const meta = symbols.get(token.toLowerCase());
  if (!meta || meta.symbol.trim() === "") return undefined;
  return `${formatUnits(value, meta.decimals)} ${meta.symbol}`;
}

function decodeLog(log: { address: Address; data: Hex; topics: readonly Hex[] }): Found | undefined {
  if (log.topics.length === 0) return undefined;
  try {
    const decoded = decodeEventLog({
      abi: activityEvents,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    return { eventName: decoded.eventName, address: log.address, args: asRecord(decoded.args) };
  } catch {
    return undefined;
  }
}

/** One row per transaction. A swap, launch, or bridge hides the token transfers inside that same transaction. */
export function classifyReceipt(
  logs: ReadonlyArray<{ address: Address; data: Hex; topics: readonly Hex[] }>,
  context: ActivityContext,
): ActivityDraft | undefined {
  const events = logs.flatMap((log) => {
    const found = decodeLog(log);
    return found ? [found] : [];
  });
  const { user, symbols, pairs } = context;

  const launched = events.find(
    (event) => event.eventName === "TokenLaunched" && same(readAddress(event.args.creator), user),
  );
  if (launched) {
    const seeded = events.find((event) => event.eventName === "LaunchSeeded");
    const token = readAddress(launched.args.token);
    const received = money(symbols, token, readUint(seeded?.args.creatorAmount));
    const pool = money(symbols, token, readUint(seeded?.args.liquidityTokens));
    return {
      kind: "Launch",
      amountLabel: received ?? "Amount unavailable",
      detail: pool
        ? `Creator share on this network. This chain's pool received ${pool}. The other chains mint only their own pool share.`
        : "Token launched on this network.",
    };
  }

  const oftOut = events.find((event) => event.eventName === "OftSent" && same(readAddress(event.args.sender), user));
  if (oftOut) {
    return {
      kind: "Bridge",
      amountLabel: money(symbols, oftOut.address, readUint(oftOut.args.amount)) ?? "Amount unavailable",
      detail: `Burned here. The peer mints on ${eidName(readEid(oftOut.args.dstEid))}.`,
    };
  }

  const oftIn = events.find(
    (event) => event.eventName === "OftReceived" && same(readAddress(event.args.recipient), user),
  );
  if (oftIn) {
    return {
      kind: "Bridge",
      amountLabel: money(symbols, oftIn.address, readUint(oftIn.args.amount)) ?? "Amount unavailable",
      detail: `Minted here after a burn on ${eidName(readEid(oftIn.args.srcEid))}.`,
    };
  }

  const locked = events.find((event) => event.eventName === "BridgeSent" && same(readAddress(event.args.sender), user));
  if (locked) {
    const amount = readUint(locked.args.amount);
    const transfer = events.find(
      (event) =>
        event.eventName === "Transfer" &&
        same(readAddress(event.args.from), user) &&
        readUint(event.args.value) === amount,
    );
    return {
      kind: "Bridge",
      amountLabel: money(symbols, transfer?.address, amount) ?? "Amount unavailable",
      detail: `Locked here. Escrow releases on ${eidName(readEid(locked.args.dstEid))}.`,
    };
  }

  const released = events.find(
    (event) => event.eventName === "BridgeReceived" && same(readAddress(event.args.recipient), user),
  );
  if (released) {
    const amount = readUint(released.args.amount);
    const transfer = events.find(
      (event) =>
        event.eventName === "Transfer" &&
        same(readAddress(event.args.to), user) &&
        readUint(event.args.value) === amount,
    );
    return {
      kind: "Bridge",
      amountLabel: money(symbols, transfer?.address, amount) ?? "Amount unavailable",
      detail: `Released from escrow on this network. Sent from ${eidName(readEid(released.args.srcEid))}.`,
    };
  }

  const filled = events.find((event) => event.eventName === "SwapFilled" && same(readAddress(event.args.user), user));
  if (filled) {
    const paid = money(symbols, readAddress(filled.args.tokenIn), readUint(filled.args.amountIn));
    const got = money(symbols, readAddress(filled.args.tokenOut), readUint(filled.args.amountOut));
    return {
      kind: "Swap",
      amountLabel: paid && got ? `${paid} → ${got}` : "Amount unavailable",
      detail: "Filled from the pool.",
    };
  }

  const swapped = events.find((event) => {
    if (event.eventName !== "Swap") return false;
    return same(readAddress(event.args.sender), user) || same(readAddress(event.args.recipient), user);
  });
  if (swapped) {
    const tokenIn = readAddress(swapped.args.tokenIn);
    const pair = pairs.get(swapped.address.toLowerCase());
    const tokenOut =
      tokenIn && pair
        ? tokenIn.toLowerCase() === pair.nix.toLowerCase()
          ? pair.token
          : pair.nix
        : undefined;
    const paid = money(symbols, tokenIn, readUint(swapped.args.amountIn));
    const got = money(symbols, tokenOut, readUint(swapped.args.amountOut));
    return {
      kind: "Swap",
      amountLabel: paid && got ? `${paid} → ${got}` : paid ?? "Amount unavailable",
      detail: "Swapped in the pool.",
    };
  }

  const added = events.find(
    (event) => event.eventName === "LiquidityAdded" && same(readAddress(event.args.provider), user),
  );
  if (added) return liquidityRow("Add liquidity", "Deposited into the pool.", added, symbols, pairs);

  const removed = events.find(
    (event) => event.eventName === "LiquidityRemoved" && same(readAddress(event.args.provider), user),
  );
  if (removed) return liquidityRow("Remove liquidity", "Withdrawn from the pool.", removed, symbols, pairs);

  const deposited = events.find(
    (event) => event.eventName === "LiquidityDeposited" && same(readAddress(event.args.from), user),
  );
  if (deposited) {
    const amount = readUint(deposited.args.amount);
    const transfer = events.find(
      (event) =>
        event.eventName === "Transfer" &&
        same(readAddress(event.args.from), user) &&
        readUint(event.args.value) === amount,
    );
    return {
      kind: "Escrow deposit",
      amountLabel: money(symbols, transfer?.address, amount) ?? "Amount unavailable",
      detail: "Deposited into bridge escrow on this network.",
    };
  }

  const submitted = events.find(
    (event) => event.eventName === "IntentSubmitted" && same(readAddress(event.args.user), user),
  );
  if (submitted) {
    return {
      kind: "Swap",
      amountLabel: "Encrypted amount",
      detail: "Swap order submitted. The solver fills it from the pool.",
    };
  }

  const sent = events.find((event) => event.eventName === "Transfer" && same(readAddress(event.args.from), user));
  if (sent) {
    const to = readAddress(sent.args.to);
    const label = money(symbols, sent.address, readUint(sent.args.value)) ?? "Amount unavailable";
    if (!to || to.toLowerCase() === ZERO) return { kind: "Send", amountLabel: label, detail: "Burned." };
    return { kind: "Send", amountLabel: label, detail: `To ${shortAddress(to)}.` };
  }

  const received = events.find(
    (event) => event.eventName === "Transfer" && same(readAddress(event.args.to), user) && !same(readAddress(event.args.from), user),
  );
  if (received) {
    const from = readAddress(received.args.from);
    const label = money(symbols, received.address, readUint(received.args.value)) ?? "Amount unavailable";
    return {
      kind: "Receive",
      amountLabel: label,
      detail: !from || from.toLowerCase() === ZERO ? "Minted to this wallet." : `From ${shortAddress(from)}.`,
    };
  }

  return undefined;
}

function liquidityRow(
  kind: "Add liquidity" | "Remove liquidity",
  detail: string,
  event: Found,
  symbols: Map<string, TokenMeta>,
  pairs: Map<string, { nix: Address; token: Address }>,
): ActivityDraft {
  const pair = pairs.get(event.address.toLowerCase());
  const nixText = money(symbols, pair?.nix, readUint(event.args.nixAmount));
  const tokenText = money(symbols, pair?.token, readUint(event.args.tokenAmount));
  return {
    kind,
    amountLabel: nixText && tokenText ? `${nixText} + ${tokenText}` : "Amount unavailable",
    detail,
  };
}

export function tokenAddressesIn(logs: ReadonlyArray<{ address: Address; data: Hex; topics: readonly Hex[] }>) {
  const found = new Set<string>();
  for (const log of logs) {
    const event = decodeLog(log);
    if (!event) continue;
    if (event.eventName === "Transfer" || event.eventName === "OftSent" || event.eventName === "OftReceived") {
      found.add(event.address.toLowerCase());
    }
    for (const key of ["token", "tokenIn", "tokenOut"] as const) {
      const value = readAddress(event.args[key]);
      if (value) found.add(value.toLowerCase());
    }
  }
  return [...found];
}
