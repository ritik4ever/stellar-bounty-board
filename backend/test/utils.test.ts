import { describe, it, expect } from "vitest";
import { isValidStellarAddress } from "../src/utils";

describe("isValidStellarAddress", () => {
  it("returns true for a valid Ed25519 public key", () => {
    const result = isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(result).toBe(true);
  });

  it("returns false for an empty string", () => {
    const result = isValidStellarAddress("");
    expect(result).toBe(false);
  });

  it("returns false for a string that is too short", () => {
    const result = isValidStellarAddress("GABCD");
    expect(result).toBe(false);
  });

  it("returns false for a string that is too long", () => {
    const result = isValidStellarAddress("G" + "A".repeat(100));
    expect(result).toBe(false);
  });

  it("returns false for an invalid prefix (non-G)", () => {
    const result = isValidStellarAddress("AABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN");
    expect(result).toBe(false);
  });

  it("returns false for a string with invalid characters", () => {
    const result = isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!!");
    expect(result).toBe(false);
  });

  it("returns false for a string with lowercase characters", () => {
    const result = isValidStellarAddress("gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result).toBe(false);
  });

  it("returns false for null input", () => {
    const result = isValidStellarAddress(null as unknown as string);
    expect(result).toBe(false);
  });

  it("returns false for undefined input", () => {
    const result = isValidStellarAddress(undefined as unknown as string);
    expect(result).toBe(false);
  });

  it("returns false when input is a number", () => {
    const result = isValidStellarAddress(12345 as unknown as string);
    expect(result).toBe(false);
  });

  it("returns false when input is an object", () => {
    const result = isValidStellarAddress({} as unknown as string);
    expect(result).toBe(false);
  });

  it("is exported as a function", () => {
    expect(typeof isValidStellarAddress).toBe("function");
  });
});
