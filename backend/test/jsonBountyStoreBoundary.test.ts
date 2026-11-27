import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER } from "./fixtures";

/**
 * JSON bounty store writes boundary (Issue #1920 / SBB-2026-451).
 *
 * Verifies that a status change alongside its event and audit-log append
 * preserves one durable version and complete event history, and fails closed
 * without mutating `bounties.json` if the audit store write fails.
 */

let storeFile: string;
let auditFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `json-store-boundary-${randomUUID()}.json`);
  auditFile = storeFile.replace(/\.json$/i, ".audit.json");
  fs.writeFileSync(storeFile, "[]", "utf8");
  fs.writeFileSync(auditFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  vi.restoreAllMocks();
  for (const file of [storeFile, auditFile]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort */
    }
  }
});

async function loadStore() {
  return import("../src/services/bountyStore");
}

function readPersistedBounty(id: string) {
  const records = JSON.parse(fs.readFileSync(storeFile, "utf8")) as Array<{
    id: string;
    status: string;
    version: number;
    events: Array<{ type: string; actor?: string }>;
  }>;
  return records.find((r) => r.id === id);
}

function readPersistedAudit(bountyId: string) {
  const records = JSON.parse(fs.readFileSync(auditFile, "utf8")) as Array<{
    bountyId: string;
    transition: string;
    fromStatus: string | null;
    toStatus: string;
  }>;
  return records.filter((r) => r.bountyId === bountyId);
}

describe("JSON bounty store writes boundary (#1920)", () => {
  it("preserves one durable version and complete event + audit history across status transitions", async () => {
    const store = await loadStore();
    const created = await store.createBounty({
      repo: "owner/repo-name",
      issueNumber: 451,
      title: "JSON store boundary bounty",
      summary: "Verifies coupled status + event + audit persistence.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 250,
      deadlineDays: 7,
      labels: [],
    });

    await store.reserveBounty(created.id, CONTRIBUTOR, 1);
    await store.submitBounty(created.id, CONTRIBUTOR, "https://github.com/owner/repo-name/pull/1", "ready");
    await store.releaseBounty(created.id, MAINTAINER, "0xdeadbeef");

    const persisted = readPersistedBounty(created.id);
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe("released");
    expect(persisted?.version).toBe(4);
    expect(persisted?.events.map((e) => e.type)).toEqual([
      "created",
      "reserved",
      "submitted",
      "released",
    ]);

    const audit = readPersistedAudit(created.id);
    expect(audit.map((a) => `${a.fromStatus}->${a.toStatus}:${a.transition}`)).toEqual([
      "open->reserved:reserve",
      "reserved->submitted:submit",
      "submitted->released:release",
    ]);
  });

  it("leaves bounties.json at its prior durable version and event history if audit store is corrupt or fails", async () => {
    const store = await loadStore();
    const created = await store.createBounty({
      repo: "owner/repo-name",
      issueNumber: 452,
      title: "Audit failure rollback bounty",
      summary: "Must not advance version or status when audit append fails.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 100,
      deadlineDays: 7,
      labels: [],
    });

    // Corrupt audit store before reserve transition
    fs.writeFileSync(auditFile, "{corrupt-json", "utf8");

    await expect(
      store.reserveBounty(created.id, CONTRIBUTOR, 1),
    ).rejects.toThrow();

    // Durable version and event history in bounties.json remain untouched at version 1
    const afterFailure = readPersistedBounty(created.id);
    expect(afterFailure?.status).toBe("open");
    expect(afterFailure?.version).toBe(1);
    expect(afterFailure?.events.map((e) => e.type)).toEqual(["created"]);

    // Restore valid audit store and verify transition succeeds cleanly once healthy
    fs.writeFileSync(auditFile, "[]", "utf8");
    const reserved = await store.reserveBounty(created.id, CONTRIBUTOR, 1);
    expect(reserved.status).toBe("reserved");
    expect(reserved.version).toBe(2);
    expect(readPersistedBounty(created.id)?.events.map((e) => e.type)).toEqual([
      "created",
      "reserved",
    ]);
  });
});
