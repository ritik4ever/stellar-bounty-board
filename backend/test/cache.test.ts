import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCache, RedisCache, NoOpCache } from "../src/services/cache";
import { MAINTAINER } from "./fixtures";

describe("InMemoryCache", () => {
  it("stores and returns a value within its TTL", async () => {
    const cache = new InMemoryCache();
    await cache.set("k", "v", 5);
    expect(await cache.get("k")).toBe("v");
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      await cache.set("k", "v", 5);
      vi.advanceTimersByTime(5_001);
      expect(await cache.get("k")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a key", async () => {
    const cache = new InMemoryCache();
    await cache.set("k", "v", 5);
    await cache.del("k");
    expect(await cache.get("k")).toBeNull();
  });
});

describe("RedisCache", () => {
  it("delegates get/set/del to the client", async () => {
    const client = {
      get: vi.fn().mockResolvedValue("cached"),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = new RedisCache(client as any);
    expect(await cache.get("k")).toBe("cached");
    await cache.set("k", "v", 5);
    expect(client.set).toHaveBeenCalledWith("k", "v", "EX", 5);
    await cache.del("k");
    expect(client.del).toHaveBeenCalledWith("k");
  });

  it("degrades to a miss when the client throws", async () => {
    const client = {
      get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      set: vi.fn(),
      del: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = new RedisCache(client as any);
    expect(await cache.get("k")).toBeNull();
  });
});

describe("NoOpCache", () => {
  it("never stores anything", async () => {
    const cache = new NoOpCache();
    await cache.set("k", "v", 5);
    expect(await cache.get("k")).toBeNull();
  });
});

describe("listBountiesCached", () => {
  let storeFile: string;

  beforeEach(() => {
    storeFile = path.join(os.tmpdir(), `bounty-cache-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, "[]", "utf8");
    process.env.BOUNTY_STORE_PATH = storeFile;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BOUNTY_STORE_PATH;
    for (const f of [storeFile, storeFile.replace(/\.json$/i, ".audit.json")]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* best-effort */
      }
    }
  });

  it("serves a cached list and refreshes only after invalidation", async () => {
    const { createBounty, listBountiesCached, invalidateBountyCache } = await import(
      "../src/services/bountyStore"
    );
    const { InMemoryCache: Mem } = await import("../src/services/cache");
    const cache = new Mem();

    const makeInput = (issueNumber: number) => ({
      repo: "acme/widget",
      issueNumber,
      title: `Bounty ${issueNumber} needs a fix in the loading flow`,
      summary: "A sufficiently long summary describing the task for contributors.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 100,
      deadlineDays: 30,
      labels: ["help wanted"],
    });

    await createBounty(makeInput(1));
    expect((await listBountiesCached({}, cache)).length).toBe(1);

    // A write that bypasses this injected cache leaves the cached value stale.
    await createBounty(makeInput(2));
    expect((await listBountiesCached({}, cache)).length).toBe(1);

    // Invalidation forces a refresh from the store.
    await invalidateBountyCache(cache);
    expect((await listBountiesCached({}, cache)).length).toBe(2);
  });
});
