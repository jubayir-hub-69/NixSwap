/** NIX value of a token balance. `priceX18` is NIX per token, scaled by 1e18. */
export function tokenValueNix(balance: bigint, priceX18: bigint) {
  if (balance <= 0n || priceX18 <= 0n) return 0n;
  return (balance * priceX18) / 10n ** 18n;
}

/** Value-weighted price move. Returns null when nothing in the book has a recorded change. */
export function weightedChangeBps(parts: { value: bigint; changeBps: number | null }[]) {
  let weight = 0n;
  let scored = 0n;
  for (const part of parts) {
    if (part.changeBps === null || part.value <= 0n) continue;
    weight += part.value;
    scored += part.value * BigInt(part.changeBps);
  }
  if (weight === 0n) return null;
  const result = Number(scored / weight);
  return Number.isFinite(result) ? result : null;
}

/** Share of a priced total, in basis points. */
export function shareBps(value: bigint, total: bigint) {
  if (value <= 0n || total <= 0n) return null;
  const bps = Number((value * 10000n) / total);
  return Number.isFinite(bps) ? bps : null;
}
