import assert from "node:assert/strict";
import test from "node:test";
import { displayLogo, isLogoURI } from "./logo.ts";

test("a logo link is an optional https or ipfs URL", () => {
  assert.equal(isLogoURI(""), true);
  assert.equal(isLogoURI("https://example.com/alpha.png"), true);
  assert.equal(isLogoURI("ipfs://bafybeigdyrzt5sfp7kqq"), true);
  assert.equal(isLogoURI("http://example.com/a.png"), false);
  assert.equal(isLogoURI(`https://${"a".repeat(200)}`), false);
  assert.equal(displayLogo("https://example.com/alpha.png"), "https://example.com/alpha.png");
  assert.equal(displayLogo("ipfs://bafybeigdyrzt5sfp7kqq"), "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7kqq");
  assert.equal(displayLogo("javascript:alert(1)"), undefined);
  assert.equal(displayLogo(""), undefined);
});
