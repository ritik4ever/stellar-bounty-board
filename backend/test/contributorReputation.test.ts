import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BountyRecord } from "../src/services/bountyStore";
import type { ReputationLevel } from "../src/services/contributorReputation";
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bounty-reputation-"));
  storeFile = path.join(tmpDir, "store.json");
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

async function loadService() {
  return import("../src/services/contributorReputation");
}

describe("getContributorReputation (#1459)", () => {
  it("returns a null reputation for a first-time contributor", async () => {
    const { getContributorReputation } = await loadService();

    expect(getContributorReputation(CONTRIBUTOR)).toEqual({
      address: CONTRIBUTOR,
      reputation: null,
      releasedCount: 0,
      totalEarned: 0,
      level: null,
      isFirstTime: true,
    });
  });

  it("counts only released bounties toward reputation", async () => {
    const records: BountyRecord[] = [
      makeRecord({ status: "released", contributor: CONTRIBUTOR, amount: 100 }),
      makeRecord({ status: "released", contributor: CONTRIBUTOR, amount: 250 }),
      makeRecord({ status: "reserved", contributor: CONTRIBUTOR, amount: 999 }),
      makeRecord({ status: "submitted", contributor: CONTRIBUTOR, amount: 999 }),
      makeRecord({ status: "refunded", contributor: CONTRIBUTOR, amount: 999 }),
      makeRecord({ status: "open", amount: 20 }),
    ];
    fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");

    const { getContributorReputation } = await loadService();
    const reputation = getContributorReputation(CONTRIBUTOR);

    expect(reputation.reputation).toBe(2);
    expect(reputation.releasedCount).toBe(2);
    expect(reputation.totalEarned).toBeCloseTo(350);
    expect(reputation.level).toBe("rising");
    expect(reputation.isFirstTime).toBe(false);
  });

  it("ignores released bounties belonging to other contributors", async () => {
    const OTHER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZRCKA2LZZZM3G4EQN2M7";
    fs.writeFileSync(
      storeFile,
      JSON.stringify([makeRecord({ status: "released", contributor: OTHER, amount: 500 })]),
      "utf8",
    );

    const { getContributorReputation } = await loadService();
    const reputation = getContributorReputation(CONTRIBUTOR);

    expect(reputation.reputation).toBeNull();
    expect(reputation.totalEarned).toBe(0);
    expect(reputation.isFirstTime).toBe(true);
  });

  it("maps completed-bounty counts onto trust levels", async () => {
    const cases: Array<[number, ReputationLevel]> = [
      [1, "rising"],
      [2, "rising"],
      [3, "trusted"],
      [4, "trusted"],
      [5, "veteran"],
      [9, "veteran"],
    ];

    for (const [count, level] of cases) {
      const records = Array.from({ length: count }, () =>
        makeRecord({ status: "released", contributor: CONTRIBUTOR, amount: 10 }),
      );
      fs.writeFileSync(storeFile, JSON.stringify(records), "utf8");
      vi.resetModules();

      const { getContributorReputation } = await loadService();
      const reputation = getContributorReputation(CONTRIBUTOR);

      expect(reputation.level).toBe(level);
      expect(reputation.reputation).toBe(count);
    }
  });
});
