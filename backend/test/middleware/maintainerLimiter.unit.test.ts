import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockNext, mockReq, mockRes, snapshotEnv } from "./helpers";

// Store failures and lock failures are covered in
// test/middlewareDependencyErrors.test.ts; this file covers the limiting logic.

const MAINTAINER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NOW = 1_900_000_000_000;
const WINDOW_MS = 60_000;

const restoreEnv = snapshotEnv(
  "NODE_ENV",
  "MAINTAINER_BOUNTY_RATE_LIMIT",
  "MAINTAINER_BOUNTY_RATE_WINDOW_MS",
  "MAINTAINER_RATE_LIMIT_STORE_PATH",
  "BOUNTY_STORE_PATH",
);

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maintainer-limiter-"));
  storePath = path.join(tmpDir, "limits.json");
  process.env.NODE_ENV = "production";
  process.env.MAINTAINER_BOUNTY_RATE_LIMIT = "2";
  process.env.MAINTAINER_BOUNTY_RATE_WINDOW_MS = String(WINDOW_MS);
  process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = storePath;
  delete process.env.BOUNTY_STORE_PATH;
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  // LIMIT and WINDOW_MS are read at module load.
  vi.resetModules();
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function limiter() {
  return (await import("../../src/middleware/maintainerLimiter")).maintainerLimiter;
}

async function run(body: unknown) {
  const middleware = await limiter();
  const out = mockRes();
  const next = mockNext();
  await middleware(mockReq({ body }), out.res, next);
  return { ...out, next };
}

function readStore(file = storePath) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("maintainerLimiter", () => {
  it("passes through without touching the store when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    const out = await run({ maintainer: MAINTAINER });
    expect(out.next).toHaveBeenCalledWith();
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it.each([
    ["no body", undefined],
    ["no maintainer", {}],
    ["an empty maintainer", { maintainer: "" }],
    ["a non-string maintainer", { maintainer: 42 }],
  ])("passes through with %s and does not create the store", async (_label, body) => {
    const out = await run(body);
    expect(out.next).toHaveBeenCalledWith();
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it("records each allowed request and creates the store and its directory", async () => {
    process.env.MAINTAINER_RATE_LIMIT_STORE_PATH = path.join(tmpDir, "nested", "dir", "limits.json");
    const out = await run({ maintainer: MAINTAINER });
    expect(out.next).toHaveBeenCalledWith();
    expect(readStore(process.env.MAINTAINER_RATE_LIMIT_STORE_PATH)).toEqual({
      [MAINTAINER]: { timestamps: [NOW] },
    });
  });

  it("allows exactly LIMIT requests in the window, then responds 429 with Retry-After", async () => {
    expect((await run({ maintainer: MAINTAINER })).next).toHaveBeenCalledWith();
    vi.mocked(Date.now).mockReturnValue(NOW + 10_000);
    expect((await run({ maintainer: MAINTAINER })).next).toHaveBeenCalledWith();

    vi.mocked(Date.now).mockReturnValue(NOW + 20_000);
    const limited = await run({ maintainer: MAINTAINER });
    expect(limited.statusCode()).toBe(429);
    expect(limited.body()).toEqual({ error: "Too many requests. Please retry later." });
    // Oldest request at NOW expires at NOW + 60s; 40s remain.
    expect(limited.headers["retry-after"]).toBe("40");
    expect(limited.next).not.toHaveBeenCalled();
    // A rejected request is not recorded.
    expect(readStore()[MAINTAINER].timestamps).toHaveLength(2);
  });

  it("frees a slot once the oldest timestamp leaves the window (boundary is exclusive)", async () => {
    fs.writeFileSync(storePath, JSON.stringify({ [MAINTAINER]: { timestamps: [NOW - WINDOW_MS, NOW - 1] } }));
    const out = await run({ maintainer: MAINTAINER });
    expect(out.next).toHaveBeenCalledWith();
    // The timestamp exactly WINDOW_MS old was pruned.
    expect(readStore()[MAINTAINER].timestamps).toEqual([NOW - 1, NOW]);
  });

  it("still limits when the oldest timestamp is 1ms inside the window", async () => {
    fs.writeFileSync(storePath, JSON.stringify({ [MAINTAINER]: { timestamps: [NOW - WINDOW_MS + 1, NOW - 1] } }));
    const out = await run({ maintainer: MAINTAINER });
    expect(out.statusCode()).toBe(429);
    expect(out.headers["retry-after"]).toBe("1");
  });

  it("tracks maintainers independently", async () => {
    fs.writeFileSync(storePath, JSON.stringify({ [MAINTAINER]: { timestamps: [NOW - 2, NOW - 1] } }));
    expect((await run({ maintainer: OTHER })).next).toHaveBeenCalledWith();
    expect((await run({ maintainer: MAINTAINER })).statusCode()).toBe(429);
  });

  it.each(["", "not json", "[", "null", "5", "[]", "\"text\""])("treats a store of %j as empty", async (contents) => {
    fs.writeFileSync(storePath, contents);
    const out = await run({ maintainer: MAINTAINER });
    expect(out.next).toHaveBeenCalledWith();
    expect(readStore()).toEqual({ [MAINTAINER]: { timestamps: [NOW] } });
  });

  it.each([
    ["no timestamps", {}],
    ["non-array timestamps", { timestamps: "oops" }],
    ["a null record", null],
  ])("treats a maintainer entry with %s as having no prior requests", async (_label, entry) => {
    fs.writeFileSync(storePath, JSON.stringify({ [MAINTAINER]: entry }));
    const out = await run({ maintainer: MAINTAINER });
    expect(out.next).toHaveBeenCalledWith();
    expect(readStore()[MAINTAINER]).toEqual({ timestamps: [NOW] });
  });

  it("ignores non-numeric timestamps instead of counting them", async () => {
    fs.writeFileSync(storePath, JSON.stringify({ [MAINTAINER]: { timestamps: ["x", null, NOW - 1] } }));
    const out = await run({ maintainer: MAINTAINER });
    expect(out.next).toHaveBeenCalledWith();
    expect(readStore()[MAINTAINER].timestamps).toEqual([NOW - 1, NOW]);
  });

  it("uses maintainer_rate_limits.json beside BOUNTY_STORE_PATH when no explicit path is set", async () => {
    delete process.env.MAINTAINER_RATE_LIMIT_STORE_PATH;
    process.env.BOUNTY_STORE_PATH = path.join(tmpDir, "bounties.json");
    await run({ maintainer: MAINTAINER });
    expect(fs.existsSync(path.join(tmpDir, "maintainer_rate_limits.json"))).toBe(true);
  });

  it("serialises concurrent requests so none exceed the limit", async () => {
    const middleware = await limiter();
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const out = mockRes();
        const next = mockNext();
        await middleware(mockReq({ body: { maintainer: MAINTAINER } }), out.res, next);
        return next.mock.calls.length > 0 ? "allowed" : out.statusCode();
      }),
    );
    expect(results.filter((r) => r === "allowed")).toHaveLength(2);
    expect(results.filter((r) => r === 429)).toHaveLength(3);
    expect(readStore()[MAINTAINER].timestamps).toHaveLength(2);
  });
});
