import { describe, expect, it } from "vitest";
import pino from "pino";
import { Keypair } from "@stellar/stellar-sdk";
import { baseLoggerOptions, redactStellarSecrets } from "../src/logger";

const SECRET = Keypair.random().secret(); // valid Stellar seed: S + 55 base32 chars

describe("redactStellarSecrets", () => {
  it("redacts a bare secret key string", () => {
    expect(redactStellarSecrets(SECRET)).toBe("[redacted-secret-key]");
  });

  it("redacts a secret key embedded in a message", () => {
    const out = redactStellarSecrets(`signing failed for ${SECRET} on submit`) as string;
    expect(out).not.toContain(SECRET);
    expect(out).toContain("[redacted-secret-key]");
  });

  it("redacts secret keys nested in objects and arrays", () => {
    const out = redactStellarSecrets({
      keypair: { secretKey: SECRET },
      candidates: [SECRET, "not-a-secret"],
    }) as { keypair: { secretKey: string }; candidates: string[] };
    expect(out.keypair.secretKey).toBe("[redacted-secret-key]");
    expect(out.candidates[0]).toBe("[redacted-secret-key]");
    expect(out.candidates[1]).toBe("not-a-secret");
  });

  it("leaves non-secret values untouched", () => {
    expect(redactStellarSecrets("hello world")).toBe("hello world");
    expect(redactStellarSecrets(42)).toBe(42);
  });
});

describe("logger redaction (pino)", () => {
  function capture(): { lines: string[]; log: pino.Logger } {
    const lines: string[] = [];
    const stream = { write: (chunk: string) => void lines.push(chunk) };
    return { lines, log: pino(baseLoggerOptions, stream) };
  }

  it("never writes a Stellar secret key to log output (message or fields)", () => {
    const { lines, log } = capture();
    log.info({ secretKey: SECRET, nested: { privateKey: SECRET } }, `boom ${SECRET}`);
    const output = lines.join("");
    expect(output).not.toContain(SECRET);
  });

  it("masks named key fields via path redaction", () => {
    const { lines, log } = capture();
    // `*.secretKey` matches one level deep, so nest the fields under a key.
    log.info({ wallet: { secretKey: "plain", privateKey: "plain", seed: "plain" } }, "redact paths");
    const entry = JSON.parse(lines[0]);
    expect(entry.wallet.secretKey).toBe("[redacted]");
    expect(entry.wallet.privateKey).toBe("[redacted]");
    expect(entry.wallet.seed).toBe("[redacted]");
  });
});
