import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, CONTRIBUTOR } from "./fixtures";

let storeFile: string;

const DAY_SECONDS = 24 * 60 * 60;

/**
 * A minimal released bounty record written straight to the store file.
 * `archiveOldBounties` only inspects `status`, `archived`, the terminal
 * timestamp and `version`/`events`, so a lean record is sufficient here.
 */
function releasedBounty(
  id: string,
  releasedDaysAgo: number,
  overrides: Partial<Record<string, unknown>> = {}
) {
  const releasedAt = Math.floor(Date.now() / 1000) - releasedDaysAgo * DAY_SECONDS;
  return {
    id,
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 1,
    title: `Released bounty ${id}`,
    summary: "Fixture bounty",
    maintainer: MAINTAINER,
    contributor: CONTRIBUTOR,
    tokenSymbol: "XLM",
    tokenAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: 100,
    labels: [],
    status: "released",
    createdAt: releasedAt,
    deadlineAt: releasedAt,
    releasedAt,
    version: 1,
    events: [],
    ...overrides,
  };
}

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-archive-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, ".audit.json");
    fs.unlinkSync(auditStorePath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

describe("API — admin archive endpoint", () => {
  it("archives only bounties past the retention window", async () => {
    const oldReleasedAt = Math.floor(Date.now() / 1000) - 200 * DAY_SECONDS;
    const recentReleasedAt = Math.floor(Date.now() / 1000) - 10 * DAY_SECONDS;

    fs.writeFileSync(
      storeFile,
      JSON.stringify(
        [
          releasedBounty("BNT-0001", 200, { releasedAt: oldReleasedAt, createdAt: oldReleasedAt, deadlineAt: oldReleasedAt }),
          releasedBounty("BNT-0002", 10, { releasedAt: recentReleasedAt, createdAt: recentReleasedAt, deadlineAt: recentReleasedAt }),
          releasedBounty("BNT-0003", 200, {
            releasedAt: oldReleasedAt,
            createdAt: oldReleasedAt,
            deadlineAt: oldReleasedAt,
            status: "disputed",
          }),
        ],
        null,
        2
      ),
      "utf8"
    );

    const app = await getApp();
    const res = await request(app).post("/api/admin/archive").expect(200);

    expect(res.body.data.archivedCount).toBe(1);
    expect(res.body.data.archivedBountyIds).toEqual(["BNT-0001"]);
    expect(res.body.data.checkedAt).toBeGreaterThan(0);

    // The store file must reflect the archive run so the change survives
    // a restart (same persistence as the scheduled job).
    const persisted = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    const archived = persisted.find((b: { id: string }) => b.id === "BNT-0001");
    const recent = persisted.find((b: { id: string }) => b.id === "BNT-0002");
    const disputed = persisted.find((b: { id: string }) => b.id === "BNT-0003");

    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBe(res.body.data.checkedAt);
    expect(archived.events.at(-1).type).toBe("archived");
    expect(recent.archived).toBeUndefined();
    expect(disputed.archived).toBeUndefined();
  });

  it("is a no-op when nothing is past the retention window", async () => {
    const recentReleasedAt = Math.floor(Date.now() / 1000) - 10 * DAY_SECONDS;

    fs.writeFileSync(
      storeFile,
      JSON.stringify(
        [
          releasedBounty("BNT-0009", 10, {
            releasedAt: recentReleasedAt,
            createdAt: recentReleasedAt,
            deadlineAt: recentReleasedAt,
          }),
        ],
        null,
        2
      ),
      "utf8"
    );

    const app = await getApp();
    const res = await request(app).post("/api/admin/archive").expect(200);

    expect(res.body.data.archivedCount).toBe(0);
    expect(res.body.data.archivedBountyIds).toEqual([]);
  });

  it("keeps already-archived bounties untouched", async () => {
    const oldReleasedAt = Math.floor(Date.now() / 1000) - 200 * DAY_SECONDS;

    fs.writeFileSync(
      storeFile,
      JSON.stringify(
        [
          releasedBounty("BNT-0007", 200, {
            releasedAt: oldReleasedAt,
            createdAt: oldReleasedAt,
            deadlineAt: oldReleasedAt,
            archived: true,
            archivedAt: oldReleasedAt,
          }),
        ],
        null,
        2
      ),
      "utf8"
    );

    const app = await getApp();
    const res = await request(app).post("/api/admin/archive").expect(200);

    expect(res.body.data.archivedCount).toBe(0);
  });

  it("honours ARCHIVE_AFTER_DAYS when set", async () => {
    const releasedAt = Math.floor(Date.now() / 1000) - 5 * DAY_SECONDS;

    fs.writeFileSync(
      storeFile,
      JSON.stringify([releasedBounty("BNT-0011", 5, { releasedAt, createdAt: releasedAt, deadlineAt: releasedAt })], null, 2),
      "utf8"
    );

    process.env.ARCHIVE_AFTER_DAYS = "3";

    try {
      const app = await getApp();
      const res = await request(app).post("/api/admin/archive").expect(200);
      expect(res.body.data.archivedCount).toBe(1);
    } finally {
      delete process.env.ARCHIVE_AFTER_DAYS;
    }
  });
});
