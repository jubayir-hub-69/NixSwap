import assert from "node:assert/strict";
import test from "node:test";
import { formatPortfolioBalance } from "./amount.ts";

test("portfolio balances truncate to 4 decimals and keep 2 when a fraction remains", () => {
  assert.equal(formatPortfolioBalance(799100000000000000002n, 18), "799.10");
  assert.equal(formatPortfolioBalance(65354838709677419354838n, 18), "65,354.8387");
  assert.equal(formatPortfolioBalance(100n * 10n ** 18n, 18), "100");
  assert.equal(formatPortfolioBalance(12n * 10n ** 16n, 18), "0.12");
  assert.equal(formatPortfolioBalance(1n, 18), "0");
});
