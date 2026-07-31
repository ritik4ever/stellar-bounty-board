import { afterEach, describe, expect, it } from "vitest";
import { createBountySchema } from "../src/validation/schemas";
import { validCreateBody } from "./fixtures";

describe("tokenSymbol allowlist validation", () => {
  afterEach(() => {
    delete process.env.ALLOWED_TOKEN_SYMBOLS;
  });

  it("accepts token symbols from ALLOWED_TOKEN_SYMBOLS", () => {
    process.env.ALLOWED_TOKEN_SYMBOLS = "XLM,USDC,AQUA";
    expect(createBountySchema.parse({ ...validCreateBody, tokenSymbol: "AQUA" }).tokenSymbol).toBe("AQUA");
  });

  it("rejects unsupported token symbols with allowed values", () => {
    process.env.ALLOWED_TOKEN_SYMBOLS = "XLM,USDC,AQUA";
    const result = createBountySchema.safeParse({ ...validCreateBody, tokenSymbol: "XLN" });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.message).toContain("XLM, USDC, AQUA");
  });

  it("uses the default allowlist when ALLOWED_TOKEN_SYMBOLS is empty", () => {
    process.env.ALLOWED_TOKEN_SYMBOLS = "";
    expect(createBountySchema.parse({ ...validCreateBody, tokenSymbol: "USDC" }).tokenSymbol).toBe("USDC");
    expect(createBountySchema.safeParse({ ...validCreateBody, tokenSymbol: "AQUA" }).success).toBe(false);
  });
});
