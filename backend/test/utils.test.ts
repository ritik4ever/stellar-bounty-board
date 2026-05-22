import { describe, it, expect } from "vitest";
import { isValidStellarAddress } from "../src/utils";

describe("isValidStellarAddress", () => {
  it("returns true for valid Stellar address", () => {
    expect(isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBe(true);
  });

  it("returns false for invalid address", () => {
    expect(isValidStellarAddress("invalid_address")).toBe(false);
  });
});
