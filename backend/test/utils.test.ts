import { describe, expect, it } from "vitest";
import { isValidStellarAddress, resolveTokenAddress } from "../src/utils";
import { MAINTAINER } from "./fixtures";

describe("isValidStellarAddress", () => {
  it("accepts a valid Ed25519 public key", () => {
    expect(isValidStellarAddress(MAINTAINER)).toBe(true);
  });

  it("rejects a malformed address", () => {
    expect(isValidStellarAddress("not-a-key")).toBe(false);
  });
});

describe("resolveTokenAddress", () => {
  it("resolves known symbols (XLM, USDC) case-insensitively", () => {
    expect(resolveTokenAddress("XLM")).toBe(resolveTokenAddress("xlm"));
    expect(resolveTokenAddress("USDC")).toMatch(/^C/);
  });

  it("throws for an unresolvable symbol", () => {
    expect(() => resolveTokenAddress("NOT_A_REAL_TOKEN")).toThrow(
      /cannot be resolved/i,
    );
  });
});
