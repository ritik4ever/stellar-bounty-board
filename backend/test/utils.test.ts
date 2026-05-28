import { describe, expect, it } from "vitest";
import { isValidStellarAddress } from "../src/utils";

describe("utils", () => {
  it("rejects malformed Stellar addresses", () => {
    expect(isValidStellarAddress("not-a-stellar-address")).toBe(false);
  });
});
