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

/**
 * Deposit fields and the approvals already signed for them.
 * The pool form reads this after a confirmation refetch or remount, when React state has been cleared.
 */
export type PoolAmountDraft = {
  nix: string;
  token: string;
  paidNix: bigint;
  paidToken: bigint;
  account: string;
};

type StoredDraft = {
  nix: string;
  token: string;
  paidNix: string;
  paidToken: string;
  account: string;
  savedAt: number;
};

const DRAFT_TTL_MS = 30 * 60 * 1000;
const STORAGE_KEY = "nixswap.poolDrafts.v1";
const drafts = new Map<string, StoredDraft>();
const draftSnapshots = new Map<string, PoolAmountDraft>();
const draftListeners = new Set<() => void>();
let draftsHydrated = false;

export function subscribePoolDrafts(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function emitDrafts() {
  for (const listener of draftListeners) listener();
}

/** Stable snapshot for `useSyncExternalStore`. Server renders stay empty until the client store hydrates. */
export function poolDraftSnapshot(chainId: number | undefined, pair: string | undefined): PoolAmountDraft | null {
  hydratePoolDrafts();
  const key = depositDraftKey(chainId, pair);
  if (!key) return null;
  const value = drafts.get(key);
  if (!value || Date.now() - value.savedAt > DRAFT_TTL_MS) {
    if (value) drafts.delete(key);
    draftSnapshots.delete(key);
    return null;
  }
  const next = asDraft(value);
  const prev = draftSnapshots.get(key);
  if (
    prev &&
    prev.nix === next.nix &&
    prev.token === next.token &&
    prev.paidNix === next.paidNix &&
    prev.paidToken === next.paidToken &&
    prev.account === next.account
  ) {
    return prev;
  }
  draftSnapshots.set(key, next);
  return next;
}

/**
 * Fills only a blank side from the reserve ratio.
 * When both amounts are already set, returns null so a reserve refetch cannot replace them.
 */
export function ratioForEmptySide(
  nixRaw: bigint | null,
  tokenRaw: bigint | null,
  reserveNix: bigint | undefined,
  reserveToken: bigint | undefined,
): { nix: bigint; token: bigint } | null {
  if (reserveNix === undefined || reserveToken === undefined || reserveNix <= 0n || reserveToken <= 0n) return null;
  if (nixRaw && nixRaw > 0n && tokenRaw === null) {
    const token = ratioOut(nixRaw, reserveNix, reserveToken);
    return token ? { nix: nixRaw, token } : null;
  }
  if (tokenRaw && tokenRaw > 0n && nixRaw === null) {
    const nix = ratioOut(tokenRaw, reserveToken, reserveNix);
    return nix ? { nix, token: tokenRaw } : null;
  }
  return null;
}

export function depositDraftKey(chainId: number | undefined, pair: string | undefined) {
  if (!chainId || !pair) return null;
  return `${chainId}:${pair.toLowerCase()}`;
}

/** A wiped field falls back to the draft. A newer typed value wins, including "0". */
export function displayedAmount(typed: string, saved: string | undefined) {
  return typed !== "" ? typed : saved ?? "";
}

function emptyDraft(): StoredDraft {
  return { nix: "", token: "", paidNix: "0", paidToken: "0", account: "", savedAt: 0 };
}

function units(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function asDraft(value: StoredDraft): PoolAmountDraft {
  return {
    nix: value.nix,
    token: value.token,
    paidNix: units(value.paidNix),
    paidToken: units(value.paidToken),
    account: value.account,
  };
}

export function hydratePoolDrafts() {
  if (draftsHydrated || typeof window === "undefined") return;
  draftsHydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, StoredDraft>;
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value.nix !== "string" || typeof value.token !== "string") continue;
      if (typeof value.savedAt !== "number" || now - value.savedAt > DRAFT_TTL_MS) continue;
      if (!drafts.has(key)) drafts.set(key, value);
    }
  } catch {
    // Ignore unreadable session drafts. The in-memory copy still covers this page.
  }
}

function persistDrafts() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const payload: Record<string, StoredDraft> = {};
  for (const [key, value] of drafts) {
    if (now - value.savedAt > DRAFT_TTL_MS) continue;
    payload[key] = value;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private mode can reject storage. The in-memory draft still covers this page.
  }
}

export function readPoolDraft(chainId: number | undefined, pair: string | undefined): PoolAmountDraft | null {
  const key = depositDraftKey(chainId, pair);
  if (!key) return null;
  const value = drafts.get(key);
  if (!value) return null;
  if (Date.now() - value.savedAt > DRAFT_TTL_MS) {
    drafts.delete(key);
    return null;
  }
  return asDraft(value);
}

export function savePoolAmounts(chainId: number | undefined, pair: string | undefined, nix: string, token: string) {
  const key = depositDraftKey(chainId, pair);
  if (!key) return;
  hydratePoolDrafts();
  const prev = drafts.get(key) ?? emptyDraft();
  if (!nix && !token && units(prev.paidNix) === 0n && units(prev.paidToken) === 0n) {
    drafts.delete(key);
    draftSnapshots.delete(key);
    persistDrafts();
    emitDrafts();
    return;
  }
  drafts.set(key, { ...prev, nix, token, savedAt: Date.now() });
  persistDrafts();
  emitDrafts();
}

export function savePoolApproval(
  chainId: number | undefined,
  pair: string | undefined,
  account: string,
  nix: bigint,
  token: bigint,
) {
  const key = depositDraftKey(chainId, pair);
  if (!key || !account) return;
  hydratePoolDrafts();
  const prev = drafts.get(key) ?? emptyDraft();
  const paidNix = nix > units(prev.paidNix) ? nix : units(prev.paidNix);
  const paidToken = token > units(prev.paidToken) ? token : units(prev.paidToken);
  drafts.set(key, {
    ...prev,
    account: account.toLowerCase(),
    paidNix: paidNix.toString(),
    paidToken: paidToken.toString(),
    savedAt: Date.now(),
  });
  persistDrafts();
  emitDrafts();
}

export function clearPoolDraft(chainId: number | undefined, pair: string | undefined) {
  const key = depositDraftKey(chainId, pair);
  if (!key) return;
  hydratePoolDrafts();
  drafts.delete(key);
  draftSnapshots.delete(key);
  persistDrafts();
  emitDrafts();
}

export function resetPoolDrafts() {
  drafts.clear();
  draftSnapshots.clear();
  draftsHydrated = false;
  emitDrafts();
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
