import { describe, expect, it } from "vitest";

import { isValidStellarAddress } from "../src/utils";
import { CONTRIBUTOR } from "./fixtures";

describe("utils", () => {
  it("accepts valid Stellar public keys", () => {
    expect(isValidStellarAddress(CONTRIBUTOR)).toBe(true);
  });

  it("rejects malformed Stellar addresses", () => {
    expect(isValidStellarAddress("not-a-stellar-address")).toBe(false);
  });
});
