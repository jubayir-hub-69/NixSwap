/** Pure pool math and button steps. Amounts are raw token units. */

export function ratioOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint | null {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null;
  const out = (amountIn * reserveOut) / reserveIn;
  return out > 0n ? out : null;
}

/** Largest deposit that stays on the reserve ratio and within both balances. */
export function maxBalanced(
  nixBalance: bigint,
  tokenBalance: bigint,
  reserveNix: bigint,
  reserveToken: bigint,
): { nix: bigint; token: bigint } | null {
  if (nixBalance <= 0n || tokenBalance <= 0n) return null;
  if (reserveNix <= 0n || reserveToken <= 0n) return { nix: nixBalance, token: tokenBalance };
  const tokenForNix = (nixBalance * reserveToken) / reserveNix;
  if (tokenForNix > 0n && tokenForNix <= tokenBalance) return { nix: nixBalance, token: tokenForNix };
  const nixForToken = (tokenBalance * reserveNix) / reserveToken;
  if (nixForToken <= 0n) return null;
  return { nix: nixForToken, token: tokenBalance };
}

/** Pro-rata assets for `removeLiquidity`. A zero side is what makes the pair revert. */
export function quoteRemove(
  shares: bigint,
  reserveNix: bigint,
  reserveToken: bigint,
  totalLiquidity: bigint,
): { nix: bigint; token: bigint } | null {
  if (shares <= 0n || reserveNix <= 0n || reserveToken <= 0n || totalLiquidity <= 0n) return null;
  if (shares > totalLiquidity) return null;
  const nix = (shares * reserveNix) / totalLiquidity;
  const token = (shares * reserveToken) / totalLiquidity;
  if (nix === 0n || token === 0n) return null;
  return { nix, token };
}

export type Coverage = "loading" | "short" | "ok";

/**
 * `pending` is true only while this allowance has never been read.
 * A later refetch keeps the last value, so a finished approval does not fall back to "Reading…".
 * `optimistic` is the amount a receipt already approved, before the read catches up.
 */
export function allowanceCovers(
  read: bigint | undefined,
  pending: boolean,
  failed: boolean,
  optimistic: bigint,
  required: bigint,
): Coverage {
  const known = read ?? 0n;
  const covered = known > optimistic ? known : optimistic;
  if (covered >= required) return "ok";
  if (pending && !failed && read === undefined && optimistic < required) return "loading";
  return "short";
}

export type PoolAction = "connect" | "switch" | "wait" | "approve-nix" | "approve-token" | "add" | "withdraw";

export function depositAction(input: {
  connected: boolean;
  chainReady: boolean;
  hasPool: boolean;
  poolReady: boolean;
  amountsReady: boolean;
  quoteReady: boolean;
  balancePending: boolean;
  balanceFailed: boolean;
  shortNix: boolean;
  shortToken: boolean;
  nix: Coverage;
  token: Coverage;
  symbol: string;
}): { action: PoolAction; label: string } {
  if (!input.connected) return { action: "connect", label: "Connect wallet" };
  if (!input.chainReady) return { action: "switch", label: "Switch network" };
  if (!input.hasPool) return { action: "wait", label: "No launched token" };
  if (!input.poolReady) return { action: "wait", label: "Reading pool…" };
  if (!input.amountsReady) return { action: "wait", label: "Enter both amounts" };
  if (!input.quoteReady) return { action: "wait", label: "Amount is too small for this pool" };
  if (input.balancePending) return { action: "wait", label: "Reading balances…" };
  if (input.balanceFailed) return { action: "wait", label: "Balances unavailable" };
  if (input.shortNix) return { action: "wait", label: "Not enough NIX" };
  if (input.shortToken) return { action: "wait", label: `Not enough ${input.symbol}` };
  if (input.nix === "loading") return { action: "wait", label: "Reading allowances…" };
  if (input.nix === "short") return { action: "approve-nix", label: "Approve NIX" };
  if (input.token === "loading") return { action: "wait", label: "Reading allowances…" };
  if (input.token === "short") return { action: "approve-token", label: `Approve ${input.symbol}` };
  return { action: "add", label: "Add liquidity" };
}

export function withdrawAction(input: {
  connected: boolean;
  chainReady: boolean;
  poolReady: boolean;
  sharesPending: boolean;
  sharesFailed: boolean;
  owned: bigint | undefined;
  requested: bigint | undefined;
  previewReady: boolean;
}): { action: PoolAction; label: string } {
  if (!input.connected) return { action: "connect", label: "Connect wallet" };
  if (!input.chainReady) return { action: "switch", label: "Switch network" };
  if (!input.poolReady) return { action: "wait", label: "Reading pool…" };
  if (input.sharesPending) return { action: "wait", label: "Reading shares…" };
  if (input.sharesFailed || input.owned === undefined) return { action: "wait", label: "Shares unavailable" };
  if (input.owned === 0n) return { action: "wait", label: "No shares in this wallet" };
  if (input.requested === undefined || input.requested === 0n) return { action: "wait", label: "Enter shares" };
  if (input.requested > input.owned) return { action: "wait", label: "Not enough shares" };
  if (!input.previewReady) return { action: "wait", label: "Amount is too small" };
  return { action: "withdraw", label: "Withdraw liquidity" };
}

/** `quoteAdd` returns named fields or a positional tuple. */
export function pullFromQuote(value: unknown): { nix: bigint; token: bigint } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { nixUsed?: unknown; tokenUsed?: unknown; 0?: unknown; 1?: unknown };
  const nix = typeof record.nixUsed === "bigint" ? record.nixUsed : record[0];
  const token = typeof record.tokenUsed === "bigint" ? record.tokenUsed : record[1];
  if (typeof nix !== "bigint" || typeof token !== "bigint" || nix <= 0n || token <= 0n) return null;
  return { nix, token };
}
