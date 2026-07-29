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

  it("accepts an explicit token address when it matches the configured symbol", () => {
    const tokenAddress = "CCW677VKUVRVH25WJ3G7L2NKV6AEFBSFW4FG7L0XXXXXX";
    const parsed = createBountySchema.parse({
      ...validCreateBody,
      tokenSymbol: "USDC",
      tokenAddress,
    });

    expect(parsed.tokenAddress).toBe(tokenAddress);
  });

  it("rejects an explicit token address that does not match the configured symbol", () => {
    const result = createBountySchema.safeParse({
      ...validCreateBody,
      tokenSymbol: "USDC",
      tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
    });

    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.message).toContain(
      "tokenAddress must match the configured USDC token address",
    );
  });
});
