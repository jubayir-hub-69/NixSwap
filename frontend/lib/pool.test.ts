import assert from "node:assert/strict";
import test from "node:test";
import { allowanceCovers, depositAction, quoteRemove, ratioOut, withdrawAction } from "./pool.ts";

const ONE = 10n ** 18n;
const total = 447213595499957939281n;
const reserveNix = 100n * ONE;
const reserveToken = 2_000n * ONE;

test("typing one side fills the other at the reserve ratio", () => {
  assert.equal(ratioOut(200n * ONE, reserveNix, reserveToken), 4_000n * ONE);
  assert.equal(ratioOut(39_999n * ONE, reserveToken, reserveNix), (39_999n * ONE * reserveNix) / reserveToken);
});

test("approvals move from NIX to the token to add, and a refetch does not stick on Reading", () => {
  const base = {
    connected: true,
    chainReady: true,
    hasPool: true,
    poolReady: true,
    amountsReady: true,
    quoteReady: true,
    balancePending: false,
    balanceFailed: false,
    shortNix: false,
    shortToken: false,
    symbol: "XNT",
  };
  assert.equal(allowanceCovers(undefined, true, false, 0n, 200n * ONE), "loading");
  assert.equal(depositAction({ ...base, nix: "loading", token: "loading" }).label, "Reading allowances…");
  assert.equal(depositAction({ ...base, nix: "short", token: "loading" }).label, "Approve NIX");
  assert.equal(allowanceCovers(undefined, true, false, 200n * ONE, 200n * ONE), "ok");
  assert.equal(depositAction({ ...base, nix: "ok", token: "short" }).label, "Approve XNT");
  assert.equal(allowanceCovers(200n * ONE, false, false, 0n, 200n * ONE), "ok");
  assert.equal(depositAction({ ...base, nix: "ok", token: "ok" }).action, "add");
  assert.equal(allowanceCovers(200n * ONE, true, false, 0n, 200n * ONE), "ok");
});

test("withdrawing 200 shares is blocked when the wallet holds none, and allowed when the preview pays both assets", () => {
  const base = {
    connected: true,
    chainReady: true,
    poolReady: true,
    sharesPending: false,
    sharesFailed: false,
    previewReady: false,
  };
  assert.equal(withdrawAction({ ...base, owned: 0n, requested: 200n }).label, "No shares in this wallet");
  assert.equal(withdrawAction({ ...base, owned: 100n, requested: 200n }).label, "Not enough shares");
  const preview = quoteRemove(200n, reserveNix, reserveToken, total);
  assert.ok(preview);
  assert.ok(preview.nix > 0n && preview.token > 0n);
  assert.equal(
    withdrawAction({ ...base, owned: total, requested: 200n, previewReady: true }).action,
    "withdraw",
  );
  assert.equal(quoteRemove(1n, reserveNix, reserveToken, total), null);
});
