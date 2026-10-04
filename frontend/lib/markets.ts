import { formatUnits } from "@/lib/amount";

export type LaunchRow = {
  id: number;
  token: `0x${string}`;
  pair: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  supply: bigint;
  createdAt: bigint;
  active: boolean;
  /** On-chain logo link. Empty when this launch has none, or when the read is still loading. */
  logoURI?: string;
};

function asAddress(value: unknown): `0x${string}` | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined;
  return value as `0x${string}`;
}

function asUnits(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function field(record: Record<string, unknown>, key: string, index: number) {
  const named = record[key];
  if (named !== undefined) return named;
  return record[index];
}

/** Accepts a named struct or a positional tuple from `allTokens` / `tokenInfo`. */
export function parseLaunch(item: unknown, index: number): LaunchRow | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  const token = asAddress(field(record, "token", 0));
  const pair = asAddress(field(record, "pair", 1));
  const creator = asAddress(field(record, "creator", 2));
  const nameValue = field(record, "name", 3);
  const symbolValue = field(record, "symbol", 4);
  const supply = asUnits(field(record, "supply", 5));
  const createdAt = asUnits(field(record, "createdAt", 6));
  const activeValue = field(record, "active", 7);
  if (
    !token ||
    !pair ||
    !creator ||
    typeof nameValue !== "string" ||
    nameValue.length === 0 ||
    typeof symbolValue !== "string" ||
    symbolValue.length === 0 ||
    supply === undefined ||
    createdAt === undefined ||
    typeof activeValue !== "boolean"
  ) {
    return undefined;
  }
  return {
    id: index,
    token,
    pair,
    creator,
    name: nameValue,
    symbol: symbolValue,
    supply,
    createdAt,
    active: activeValue,
  };
}

export function parseLaunches(data: unknown): LaunchRow[] {
  if (!Array.isArray(data)) return [];
  const rows: LaunchRow[] = [];
  data.forEach((item, index) => {
    const row = parseLaunch(item, index);
    if (row) rows.push(row);
  });
  return rows;
}

export function parseActiveLaunch(data: unknown): { active: boolean; id: number } {
  if (Array.isArray(data) && data.length >= 2) {
    return { active: Boolean(data[0]), id: Number(data[1]) };
  }
  if (data && typeof data === "object" && "active" in data && "id" in data) {
    const record = data as { active: unknown; id: unknown };
    return { active: Boolean(record.active), id: Number(record.id) };
  }
  return { active: false, id: 0 };
}

export function shortAddress(value: string) {
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function changeBps(price: bigint, basis: bigint) {
  if (basis === 0n || price === 0n) return 0;
  const delta = price >= basis ? price - basis : -(basis - price);
  const bps = (delta * 10000n) / basis;
  const numeric = Number(bps);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatChange(bps: number) {
  const sign = bps > 0 ? "+" : "";
  return `${sign}${(bps / 100).toFixed(2)}%`;
}

export function formatPrice(priceX18: bigint) {
  if (priceX18 === 0n) return "No liquidity";
  return `${formatUnits(priceX18, 18, 6)} NIX`;
}

/** Constant-product output. Same formula as `NixPair.quoteSwap`, with no fee. */
export function quoteSwap(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null;
  const amountOut = (reserveOut * amountIn) / (reserveIn + amountIn);
  if (amountOut <= 0n) return null;
  return amountOut;
}

/** How far the constant-product fill sits from the spot quote, in basis points. */
export function priceImpactBps(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, amountOut: bigint) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n || amountOut <= 0n) return null;
  const spotOut = (reserveOut * amountIn) / reserveIn;
  if (spotOut <= 0n) return null;
  if (amountOut >= spotOut) return 0;
  const bps = Number(((spotOut - amountOut) * 10000n) / spotOut);
  return Number.isFinite(bps) ? bps : null;
}

/** Minimum output after a user slippage tolerance. 100 bps is 1%. */
export function minOutAfterSlippage(amountOut: bigint, slippageBps: number) {
  if (amountOut <= 0n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) return null;
  const next = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
  return next > 0n ? next : null;
}

export function formatImpact(bps: number | null) {
  if (bps === null) return "Unavailable";
  return `${(bps / 100).toFixed(2)}%`;
}

/** Local preview of NixPair.addLiquidity. Deposit amounts are public; this does not quote a swap. */
export function quoteAdd(
  nixAmount: bigint,
  tokenAmount: bigint,
  reserveNix: bigint,
  reserveToken: bigint,
  totalLiquidity: bigint,
) {
  if (nixAmount <= 0n || tokenAmount <= 0n) return null;
  if (totalLiquidity === 0n) {
    if (reserveNix !== 0n || reserveToken !== 0n) return null;
    return { nix: nixAmount, token: tokenAmount };
  }
  if (reserveNix <= 0n || reserveToken <= 0n) return null;
  const nixShares = (nixAmount * totalLiquidity) / reserveNix;
  const tokenShares = (tokenAmount * totalLiquidity) / reserveToken;
  const shares = nixShares < tokenShares ? nixShares : tokenShares;
  if (shares === 0n) return null;
  const nix = (shares * reserveNix) / totalLiquidity;
  const token = (shares * reserveToken) / totalLiquidity;
  if (nix === 0n || token === 0n) return null;
  return { nix, token };
}

export function nixPairFor(
  rows: LaunchRow[],
  tokenIn: string | undefined,
  tokenOut: string | undefined,
  nix: string | undefined,
) {
  if (!tokenIn || !tokenOut || !nix) return undefined;
  const left = tokenIn.toLowerCase();
  const right = tokenOut.toLowerCase();
  const base = nix.toLowerCase();
  if (left === right) return undefined;
  const launched = left === base ? right : right === base ? left : undefined;
  if (!launched) return undefined;
  return rows.find((row) => row.token.toLowerCase() === launched);
}

export function liveChange(price: bigint, mark: bigint, previous: bigint, stored: number | null) {
  if (stored !== null) return stored;
  if (mark > 0n && price !== mark) return changeBps(price, mark);
  if (previous > 0n && previous !== price) return changeBps(price, previous);
  return 0;
}

/** NIX per token, scaled by 1e18. Same formula as `NixPair._updateMark`. */
export function spotFromReserves(reserveNix: bigint, reserveToken: bigint) {
  if (reserveNix <= 0n || reserveToken <= 0n) return 0n;
  return (reserveNix * 10n ** 18n) / reserveToken;
}

/** Prefer the pair's stored reserve, then the tokens actually held by the pair. */
export function liveReserve(stored: bigint | undefined, balance: bigint | undefined) {
  if (stored === undefined && balance === undefined) return undefined;
  if (stored !== undefined && stored > 0n) return stored;
  if (balance !== undefined && balance > 0n) return balance;
  return stored ?? balance ?? 0n;
}

export function liveSpot(
  storedPrice: bigint | undefined,
  reserveNix: bigint | undefined,
  reserveToken: bigint | undefined,
) {
  if (reserveNix !== undefined && reserveToken !== undefined && reserveNix > 0n && reserveToken > 0n) {
    return spotFromReserves(reserveNix, reserveToken);
  }
  return storedPrice;
}

export type CallResult = {
  status?: "success" | "failure";
  result?: unknown;
};

export type MarketFigures =
  | { ready: false; failed: boolean }
  | {
      ready: true;
      reserveNix: bigint;
      reserveToken: bigint;
      price: bigint;
      change: number | null;
      volume24h: bigint | undefined;
    };

const MARKET_CALLS = 9;

export function figuresFromCalls(calls: readonly CallResult[] | undefined): MarketFigures {
  if (!calls || calls.length < MARKET_CALLS) return { ready: false, failed: false };
  const at = (index: number) => {
    const call = calls[index];
    if (!call || call.status === "failure") return undefined;
    return typeof call.result === "bigint" ? call.result : undefined;
  };
  const failed = calls.some((call) => call?.status === "failure");
  const reserveNix = liveReserve(at(0), at(7));
  const reserveToken = liveReserve(at(1), at(8));
  const price = liveSpot(at(2), reserveNix, reserveToken);
  if (reserveNix === undefined || reserveToken === undefined || price === undefined) {
    return { ready: false, failed };
  }
  const mark = at(3) ?? 0n;
  const previous = at(4) ?? 0n;
  return {
    ready: true,
    reserveNix,
    reserveToken,
    price,
    change: price > 0n ? liveChange(price, mark, previous, null) : null,
    volume24h: at(5),
  };
}
