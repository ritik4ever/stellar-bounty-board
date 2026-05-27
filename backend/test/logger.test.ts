import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a valid 56-char Stellar secret key (S + 55 uppercase alphanumeric). */
function makeStellarKey(suffix = "A"): string {
  const base = "S" + "0".repeat(54) + suffix;
  return base.slice(0, 56);
}

/** Capture pino log output as an array of parsed objects. */
function captureLogs() {
  const { Writable } = require("node:stream");
  const logs: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(
      chunk: Buffer,
      _encoding: string,
      callback: () => void,
    ) {
      try {
        logs.push(JSON.parse(chunk.toString()));
      } catch {
        // pino-pretty output in dev is not JSON; skip
      }
      callback();
    },
  });
  return { logs, stream };
}

const STELLAR_RE = /^S[0-9A-Z]{55}$/;

function redactStellar(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && STELLAR_RE.test(v)) {
      out[k] = "[redacted]";
    } else if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v)
    ) {
      out[k] = redactStellar(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = (v as unknown[]).map((item) =>
        typeof item === "string" && STELLAR_RE.test(item)
          ? "[redacted]"
          : item,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("logger Stellar key redaction", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("redacts a Stellar secret key via regex formatter (top-level)", async () => {
    const stellarKey = makeStellarKey("Z");
    const { logs, stream } = captureLogs();
    const pino = (await import("pino")).default;

    const testLogger = pino(
      { level: "info", formatters: { log: redactStellar } },
      stream,
    );

    testLogger.info({ key: stellarKey, safe: "keep-me" }, "log message");
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBe(1);
    expect(logs[0].key).toBe("[redacted]");
    expect(logs[0].safe).toBe("keep-me");
    // pino stores the message string under `msg`
    expect(logs[0].msg).toBe("log message");
  });

  it("redacts a Stellar key in nested objects and arrays", async () => {
    const stellarKey = makeStellarKey("X");
    const { logs, stream } = captureLogs();
    const pino = (await import("pino")).default;

    const testLogger = pino(
      { level: "info", formatters: { log: redactStellar } },
      stream,
    );

    testLogger.info(
      {
        nested: { deep: stellarKey },
        arr: [stellarKey, "safe-item"],
      },
      "nested test",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBe(1);
    const entry = logs[0] as Record<string, unknown>;
    const nested = entry.nested as Record<string, unknown>;
    expect(nested.deep).toBe("[redacted]");

    const arr = entry.arr as unknown[];
    expect(arr[0]).toBe("[redacted]");
    expect(arr[1]).toBe("safe-item");
  });

  it("does NOT redact non-Stellar strings", async () => {
    const { logs, stream } = captureLogs();
    const pino = (await import("pino")).default;

    const testLogger = pino(
      { level: "info", formatters: { log: redactStellar } },
      stream,
    );

    testLogger.info(
      { myField: "normal value", shortKey: "S1234" },
      "safe message",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBe(1);
    const entry = logs[0] as Record<string, unknown>;
    expect(entry.myField).toBe("normal value");
    expect(entry.shortKey).toBe("S1234"); // too short — not redacted
    expect(entry.msg).toBe("safe message");
  });

  it("redacts fields matching *.secretKey, *.privateKey, and *.seed paths (nested)", async () => {
    const stellarKey = makeStellarKey();
    const { logs, stream } = captureLogs();
    const pino = (await import("pino")).default;

    const testLogger = pino(
      {
        level: "info",
        redact: {
          paths: ["*.secretKey", "*.privateKey", "*.seed"],
          censor: "[redacted]",
        },
      },
      stream,
    );

    testLogger.info(
      {
        wallet: {
          secretKey: stellarKey,
          privateKey: "some-private-data",
          seed: "wallet-seed-phrase",
          publicKey: "GABCDEF1234567890",
        },
      },
      "path redaction test",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBe(1);
    const entry = logs[0] as Record<string, unknown>;
    const wallet = entry.wallet as Record<string, unknown>;
    expect(wallet.secretKey).toBe("[redacted]");
    expect(wallet.privateKey).toBe("[redacted]");
    expect(wallet.seed).toBe("[redacted]");
    expect(wallet.publicKey).toBe("GABCDEF1234567890"); // Not redacted
  });

  it("redacts top-level secretKey / privateKey / seed fields", async () => {
    const stellarKey = makeStellarKey("B");
    const { logs, stream } = captureLogs();
    const pino = (await import("pino")).default;

    const testLogger = pino(
      {
        level: "info",
        redact: {
          paths: ["secretKey", "privateKey", "seed"],
          censor: "[redacted]",
        },
      },
      stream,
    );

    testLogger.info(
      {
        secretKey: stellarKey,
        privateKey: "some-private",
        seed: "phrase",
        publicKey: "G123",
      },
      "top-level redaction",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBe(1);
    const entry = logs[0] as Record<string, unknown>;
    expect(entry.secretKey).toBe("[redacted]");
    expect(entry.privateKey).toBe("[redacted]");
    expect(entry.seed).toBe("[redacted]");
    expect(entry.publicKey).toBe("G123");
  });
});
