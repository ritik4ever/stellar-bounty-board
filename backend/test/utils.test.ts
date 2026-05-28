
import { describe, expect, it } from "vitest";
import { CONTRIBUTOR } from "./fixtures";
import { isValidStellarAddress } from "../src/utils";

describe("isValidStellarAddress", () => {
  it("accepts a valid Stellar public key", () => {
    expect(isValidStellarAddress(CONTRIBUTOR)).toBe(true);
  });

  it("rejects malformed public keys", () => {
    expect(isValidStellarAddress("not-a-stellar-public-key")).toBe(false);
  });
});
