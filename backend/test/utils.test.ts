import { describe, expect, it } from "vitest";
import { isValidStellarAddress } from "../src/utils";
import { MAINTAINER } from "./fixtures";

describe("utils", () => {
  it("validates Stellar public keys", () => {
    expect(isValidStellarAddress(MAINTAINER)).toBe(true);
    expect(isValidStellarAddress("not-a-stellar-key")).toBe(false);
  });
});
