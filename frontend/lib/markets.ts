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
};

export function parseLaunches(data: unknown): LaunchRow[] {
  if (!Array.isArray(data)) return [];
  const rows: LaunchRow[] = [];
  data.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (
      typeof record.token !== "string" ||
      typeof record.pair !== "string" ||
      typeof record.creator !== "string" ||
      typeof record.name !== "string" ||
      typeof record.symbol !== "string" ||
      typeof record.supply !== "bigint" ||
      typeof record.createdAt !== "bigint" ||
      typeof record.active !== "boolean"
    ) {
      return;
    }
    rows.push({
      id: index,
      token: record.token as `0x${string}`,
      pair: record.pair as `0x${string}`,
      creator: record.creator as `0x${string}`,
      name: record.name,
      symbol: record.symbol,
      supply: record.supply,
      createdAt: record.createdAt,
      active: record.active,
    });
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

/** Local preview of NixPair.addLiquidity. Deposit amounts are public; this does not quote a swap. */
export function quoteAdd(
  nixAmount: bigint,
  tokenAmount: bigint,
  reserveNix: bigint,
  reserveToken: bigint,
  totalLiquidity: bigint,
) {
  if (nixAmount <= 0n || tokenAmount <= 0n) return null;
  if (totalLiquidity === 0n || reserveNix === 0n || reserveToken === 0n) {
    return { nix: nixAmount, token: tokenAmount };
  }
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
