import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminApiKeyAuthMiddleware } from "../src/middleware/adminAuth";

// Low cost factor keeps the many timing-test iterations fast. Production
// uses cost 12 (see scripts/hash-admin-key.js) — the comparison mechanism
// under test (bcrypt.compare) behaves the same regardless of cost factor.
const TEST_SALT_ROUNDS = 4;
const ADMIN_KEY = "correct-admin-key-1234567890ab";
// Same length as ADMIN_KEY, differs only in the last character.
const NEAR_CORRECT_KEY = ADMIN_KEY.slice(0, -1) + "z";
// Same length as ADMIN_KEY, differs in every character.
const COMPLETELY_WRONG_KEY = "z".repeat(ADMIN_KEY.length);

/**
 * Constant-time comparisons on bcrypt-hashed secrets are dominated by the
 * cost of hashing the incoming key (identical work for every request), so
 * response times for a near-correct vs. a completely wrong key should be
 * statistically indistinguishable. We allow generous relative variance to
 * avoid flakiness on loaded CI runners; a real timing *leak* shows up as a
 * large, consistent, repeatable skew, not a borderline percentage.
 */
const MAX_RELATIVE_TIMING_DIFFERENCE = 0.5;
const TIMING_SAMPLE_SIZE = 40;
const TIMING_WARMUP_ITERATIONS = 5;

let app: express.Express;
let originalNodeEnv: string | undefined;
let originalAdminHash: string | undefined;

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  originalAdminHash = process.env.ADMIN_API_KEY_HASH;

  // The middleware short-circuits (skips auth) when NODE_ENV === "test", so
  // it must run under a non-test NODE_ENV to exercise the bcrypt.compare
  // path this suite verifies.
  process.env.NODE_ENV = "production";
  process.env.ADMIN_API_KEY_HASH = await bcrypt.hash(ADMIN_KEY, TEST_SALT_ROUNDS);

  app = express();
  app.get("/admin/protected", createAdminApiKeyAuthMiddleware(), (_req, res) => {
    res.status(200).json({ ok: true });
  });
});

afterAll(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalAdminHash === undefined) delete process.env.ADMIN_API_KEY_HASH;
  else process.env.ADMIN_API_KEY_HASH = originalAdminHash;
});

describe("admin auth middleware — functional behavior", () => {
  it("allows the request when the correct admin key is supplied", async () => {
    await request(app).get("/admin/protected").set("x-admin-api-key", ADMIN_KEY).expect(200);
  });

  it("rejects the request when the admin key is wrong", async () => {
    const res = await request(app)
      .get("/admin/protected")
      .set("x-admin-api-key", COMPLETELY_WRONG_KEY)
      .expect(401);
    expect(res.body.error).toMatch(/invalid admin api key/i);
  });

  it("rejects the request when the x-admin-api-key header is missing", async () => {
    const res = await request(app).get("/admin/protected").expect(401);
    expect(res.body.error).toMatch(/missing/i);
  });
});

describe("admin auth middleware — constant-time comparison guard", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/middleware/adminAuth.ts"), "utf8");

  it("uses bcrypt.compare (or crypto.timingSafeEqual) to verify the admin key", () => {
    const usesConstantTimeCompare = /bcrypt\.compare\s*\(/.test(source) || /timingSafeEqual\s*\(/.test(source);
    expect(usesConstantTimeCompare).toBe(true);
  });

  it("does not fall back to a naive equality check against the raw key or hash", () => {
    // Regression guard: catches a future edit that reintroduces something
    // like `incomingKey === storedHash` or `incomingKey === process.env.X`.
    const naiveComparisonPattern = /incomingKey\s*===\s*(storedHash|process\.env)/;
    expect(naiveComparisonPattern.test(source)).toBe(false);
  });
});

describe("admin auth middleware — statistical timing leak check", () => {
  async function timeRequest(key: string): Promise<number> {
    const start = performance.now();
    await request(app).get("/admin/protected").set("x-admin-api-key", key);
    return performance.now() - start;
  }

  async function sampleTimings(key: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await timeRequest(key);
    }
  }

  function mean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  it(
    "shows no significant, exploitable timing correlation between a near-correct and a completely wrong key",
    async () => {
      // Warm up so JIT/connection setup costs don't skew the first samples.
      await sampleTimings(NEAR_CORRECT_KEY, TIMING_WARMUP_ITERATIONS);
      await sampleTimings(COMPLETELY_WRONG_KEY, TIMING_WARMUP_ITERATIONS);

      // Interleave request-by-request so external jitter (GC pauses,
      // scheduler noise) affects both samples equally instead of skewing
      // whichever key type happens to run first or last.
      const nearCorrectTimings: number[] = [];
      const completelyWrongTimings: number[] = [];
      for (let i = 0; i < TIMING_SAMPLE_SIZE; i++) {
        nearCorrectTimings.push(await timeRequest(NEAR_CORRECT_KEY));
        completelyWrongTimings.push(await timeRequest(COMPLETELY_WRONG_KEY));
      }

      const nearCorrectMean = mean(nearCorrectTimings);
      const completelyWrongMean = mean(completelyWrongTimings);
      const slowerMean = Math.max(nearCorrectMean, completelyWrongMean);
      const relativeDifference = Math.abs(nearCorrectMean - completelyWrongMean) / slowerMean;

      expect(relativeDifference).toBeLessThan(MAX_RELATIVE_TIMING_DIFFERENCE);
    },
    30_000,
  );
});
