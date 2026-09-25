export const UINT64_MAX = (1n << 64n) - 1n;

export function asBigint(value: unknown): bigint | undefined {
  return typeof value === "bigint" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

export function decimalInput(value: string) {
  const next = value.replace(/,/g, "");
  return next === "" || /^\d*\.?\d*$/.test(next) ? next : null;
}

export function parseUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  try {
    return BigInt(whole + fraction.padEnd(decimals, "0"));
  } catch {
    return null;
  }
}

export function formatUnits(value: bigint, decimals: number, maxFraction = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFraction)
    .replace(/0+$/, "");
  return fractionText ? `${wholeText}.${fractionText}` : wholeText;
}
