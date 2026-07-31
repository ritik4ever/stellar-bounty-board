import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BountyRecord } from "../src/services/bountyStore";
import { CONTRIBUTOR, MAINTAINER } from "./fixtures";

let tmpDir: string;
let storeFile: string;

const now = Math.floor(Date.now() / 1000);
const deadline = now + 86400 * 30;

function makeRecord(overrides: Partial<BountyRecord>): BountyRecord {
  return {
    id: `BNT-${randomUUID().slice(0, 4)}`,
    repo: "owner/repo",
    issueNumber: 1,
    title: "Test bounty",
    summary: "A test bounty for unit testing.",
    maintainer: MAINTAINER,
    tokenSymbol: "XLM",
    amount: 100,
    labels: [],
    status: "open",
    createdAt: now,
    deadlineAt: deadline,
    version: 1,
    events: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bounty-stats-"));
  storeFile = path.join(tmpDir, "store.json");
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

async function loadStore() {
  return import("../src/services/bountyStore");
}

describe("getGlobalMetrics / getGlobalMetricsCached", () => {
  it("returns zeros for an empty store", async () => {
    const { getGlobalMetrics, getGlobalMetricsCached } = await loadStore();

    const sync = getGlobalMetrics();
    const cached = await getGlobalMetricsCached();

    const expected = {
      totalBounties: 0,
      openCount: 0,
      reservedCount: 0,
      submittedCount: 0,
      releasedCount: 0,
      refundedCount: 0,
      expiredCount: 0,
      totalFunded: 0,
      totalReleased: 0,
      uniqueMaintainers: 0,
      uniqueContributors: 0,
      protocolFeesCollected: 0,
    };

    expect(sync).toEqual(expected);
    expect(cached).toEqual(expected);
  });

  it("computes correct values for seeded bounties", async () => {
    const records: BountyRecord[] = [
      makeRecord({ status: "open", amount: 50, maintainer: MAINTAINER }),
      makeRecord({ status: "reserved", amount: 75, maintainer: MAINTAINER, contributor: CONTRIBUTOR }),
      makeRecord({ status: "submitted", amount: 30, maintainer: MAINTAINER, contributor: CONTRIBUTOR }),
      makeRecord({ status: "released", amount: 200, maintainer: MAINTAINER, contributor: CONTRIBUTOR, protocolFeeCollected: 10 }),
      makeRecord({ status: "refunded", amount: 40, maintainer: MAINTAINER }),
      makeRecord({ status: "expired", amount: 60, maintainer: MAINTAINER }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();

    expect(metrics.totalBounties).toBe(6);
    expect(metrics.openCount).toBe(1);
    expect(metrics.reservedCount).toBe(1);
    expect(metrics.submittedCount).toBe(1);
    expect(metrics.releasedCount).toBe(1);
    expect(metrics.refundedCount).toBe(1);
    expect(metrics.expiredCount).toBe(1);
    expect(metrics.totalFunded).toBeCloseTo(50 + 75 + 30 + 200 + 40 + 60);
    expect(metrics.totalReleased).toBeCloseTo(200);
    expect(metrics.uniqueMaintainers).toBe(1);
    expect(metrics.uniqueContributors).toBe(1);
    expect(metrics.protocolFeesCollected).toBeCloseTo(10);
  });

  it("counts multiple unique maintainers and contributors", async () => {
    const OTHER_MAINTAINER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZRCKA2LZZZM3G4EQN2M7";
    const OTHER_CONTRIBUTOR = "GDQJUTQYK2MQX2JQMDT3JYBPITRZBXBFQ3ZBXJWNMZV5UHGCQ6XZUIP";
    const records: BountyRecord[] = [
      makeRecord({ maintainer: MAINTAINER, contributor: CONTRIBUTOR, status: "released" }),
      makeRecord({ maintainer: OTHER_MAINTAINER, contributor: OTHER_CONTRIBUTOR, status: "released" }),
      makeRecord({ maintainer: MAINTAINER, contributor: OTHER_CONTRIBUTOR, status: "released" }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();

    expect(metrics.uniqueMaintainers).toBe(2);
    expect(metrics.uniqueContributors).toBe(2);
  });

  it("getGlobalMetricsCached returns same result as getGlobalMetrics", async () => {
    const records: BountyRecord[] = [
      makeRecord({ status: "open", amount: 42.5 }),
      makeRecord({ status: "released", amount: 57.5, contributor: CONTRIBUTOR }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics, getGlobalMetricsCached } = await loadStore();

    const sync = getGlobalMetrics();
    const cached = await getGlobalMetricsCached();

    expect(cached).toEqual(sync);
  });

  it("getGlobalMetricsCached returns cached result on second call", async () => {
    const { getGlobalMetricsCached } = await loadStore();
    const { InMemoryCache } = await import("../src/services/cache");

    const cache = new InMemoryCache();
    const first = await getGlobalMetricsCached(cache);

    // Modify the store file after caching — cache should still return original
    const newRecords: BountyRecord[] = [makeRecord({ status: "open", amount: 999 })];
    fs.writeFileSync(storeFile, JSON.stringify(newRecords), "utf8");

    const second = await getGlobalMetricsCached(cache);
    expect(second).toEqual(first);
  });
});

describe("protocolFeesCollected", () => {
  it("is 0 when no bounties exist", async () => {
    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();
    expect(metrics.protocolFeesCollected).toBe(0);
  });

  it("is 0 when released bounties have no protocolFeeCollected field", async () => {
    const records: BountyRecord[] = [
      makeRecord({ status: "released", amount: 100, contributor: CONTRIBUTOR }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();
    expect(metrics.protocolFeesCollected).toBe(0);
  });

  it("sums protocolFeeCollected across a single released bounty", async () => {
    const records: BountyRecord[] = [
      makeRecord({
        status: "released",
        amount: 500,
        contributor: CONTRIBUTOR,
        protocolFeeCollected: 25,
      }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();
    expect(metrics.protocolFeesCollected).toBeCloseTo(25);
  });

  it("sums protocolFeeCollected across multiple released bounties", async () => {
    const records: BountyRecord[] = [
      makeRecord({ status: "released", amount: 1000, contributor: CONTRIBUTOR, protocolFeeCollected: 10 }),
      makeRecord({ status: "released", amount: 2000, contributor: CONTRIBUTOR, protocolFeeCollected: 20 }),
      makeRecord({ status: "released", amount: 500,  contributor: CONTRIBUTOR, protocolFeeCollected: 5 }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();
    // 10 + 20 + 5 = 35
    expect(metrics.protocolFeesCollected).toBeCloseTo(35);
  });

  it("does not count fees from non-released bounties", async () => {
    const records: BountyRecord[] = [
      makeRecord({ status: "open",     amount: 100, protocolFeeCollected: 99 }),
      makeRecord({ status: "reserved", amount: 100, protocolFeeCollected: 99 }),
      makeRecord({ status: "refunded", amount: 100, protocolFeeCollected: 99 }),
      makeRecord({ status: "released", amount: 100, contributor: CONTRIBUTOR, protocolFeeCollected: 7 }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getGlobalMetrics } = await loadStore();
    const metrics = getGlobalMetrics();
    // Only the released one contributes
    expect(metrics.protocolFeesCollected).toBeCloseTo(7);
  });
});
