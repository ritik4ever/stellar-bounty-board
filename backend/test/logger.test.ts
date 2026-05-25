import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger";

const STELLAR_SECRET_KEY = `S${"A".repeat(55)}`;

function createCapturedLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    logger: createLogger(stream),
    output: () => chunks.join(""),
  };
}

describe("logger redaction", () => {
  it("redacts Stellar secret keys from structured fields and text messages", () => {
    const { logger, output } = createCapturedLogger();

    logger.error(
      {
        secretKey: STELLAR_SECRET_KEY,
        privateKey: STELLAR_SECRET_KEY,
        seed: STELLAR_SECRET_KEY,
        nested: { error: `Transaction failed for ${STELLAR_SECRET_KEY}` },
      },
      `failed to process ${STELLAR_SECRET_KEY}`,
    );

    expect(output()).not.toContain(STELLAR_SECRET_KEY);
    expect(output()).toContain("[redacted]");
  });

  it("does not redact Stellar public keys", () => {
    const publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const { logger, output } = createCapturedLogger();

    logger.info({ publicKey }, "public account is safe to log");

    expect(output()).toContain(publicKey);
  });
});
