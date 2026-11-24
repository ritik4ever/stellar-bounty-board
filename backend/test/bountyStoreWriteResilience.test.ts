import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BountyRecord } from "../src/services/bountyStore";
import {
  STORE_WRITE_TRACE_EVENT,
  setGlobalStoreWriteTraceSink,
  type StoreWriteTraceRecord,
} from "../src/services/bountyStore";
import { CONTRIBUTOR, MAINTAINER } from "./fixtures";

let tmpDir: string;
let storeFile: string;
let auditFile: string;

function storeTempPath(base: string, counter: number): string {
  return path.join(tmpDir, `.${base}.tmp-1-1700000000000-${counter}`);
}

function makeBounty(overrides: Partial<BountyRecord> = {}): BountyRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "BNT-9001",
    repo: "acme/widget",
    issueNumber: 1,
    title: "Resilience test bounty",
    summary: "A bounty used to exercise store write recovery paths.",
    maintainer: MAINTAINER,
    tokenSymbol: "XLM",
    tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
    amount: 100,
    labels: [],
    status: "open",
    createdAt: now,
    deadlineAt: now + 86400,
    version: 1,
    events: [{ type: "created", timestamp: now }],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bounty-write-resilience-"));
  storeFile = path.join(tmpDir, "bounties.json");
  auditFile = path.join(tmpDir, "bounties.audit.json");
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  setGlobalStoreWriteTraceSink(null);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

async function loadStore() {
  return import("../src/services/bountyStore");
}

describe("SBB-2026-452 — resume interrupted JSON store writes", () => {
  it("completes a pending bounty store temp write on the next locked write", async () => {
    const store = await loadStore();
    const bounty = makeBounty({ id: "BNT-7777", status: "reserved", contributor: CONTRIBUTOR });

    // Simulate a crash: temp file holds the intended payload, target untouched.
    fs.writeFileSync(storeTempPath("bounties.json", 1), JSON.stringify([bounty], null, 2));

    const created = await store.createBounty({
      repo: "acme/widget",
      issueNumber: 2,
      title: "Second bounty after resume",
      summary: "Ensures the pending write was applied before this create.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 10,
      deadlineDays: 7,
      labels: [],
    });

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[];
    expect(raw.some((record) => record.id === "BNT-7777")).toBe(true);
    expect(raw.some((record) => record.id === created.id)).toBe(true);

    // No temp files may be left behind.
    const leftovers = fs
      .readdirSync(tmpDir)
      .filter((name) => name.includes(".tmp-"));
    expect(leftovers).toHaveLength(0);
  });

  it("resumes a pending audit store temp write", async () => {
    const store = await loadStore();
    const auditEntry = {
      id: "AUD-000001",
      bountyId: "BNT-1",
      fromStatus: "open",
      toStatus: "reserved",
      transition: "reserve",
      actor: CONTRIBUTOR,
      timestamp: Math.floor(Date.now() / 1000),
    };
    fs.writeFileSync(storeTempPath("bounties.audit.json", 2), JSON.stringify([auditEntry], null, 2));

    const summary = store.resumeInterruptedStoreWrites();
    expect(summary.completed).toHaveLength(1);

    const raw = JSON.parse(fs.readFileSync(auditFile, "utf8")) as unknown[];
    expect(raw).toHaveLength(1);
  });

  it("discards a corrupt temp payload and keeps the committed store", async () => {
    const store = await loadStore();
    fs.writeFileSync(storeFile, JSON.stringify([makeBounty({ id: "BNT-KEEP" })]), "utf8");
    fs.writeFileSync(storeTempPath("bounties.json", 3), "{not-json!!");

    const summary = store.resumeInterruptedStoreWrites();
    expect(summary.completed).toHaveLength(0);
    expect(summary.discarded).toHaveLength(1);

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[];
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe("BNT-KEEP");
    expect(
      fs.readdirSync(tmpDir).filter((name) => name.includes(".tmp-"))
    ).toHaveLength(0);
  });

  it("discards a temp whose payload fails write validation", async () => {
    const store = await loadStore();
    fs.writeFileSync(storeFile, "[]", "utf8");
    const hostile = [{ id: "BNT-EVIL", status: "not-a-status", amount: -5 }];
    fs.writeFileSync(storeTempPath("bounties.json", 4), JSON.stringify(hostile));

    const summary = store.resumeInterruptedStoreWrites();
    expect(summary.completed).toHaveLength(0);
    expect(summary.discarded).toHaveLength(1);

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as unknown[];
    expect(raw).toHaveLength(0);
  });

  it("keeps only the newest valid temp when several interrupted writes exist", async () => {
    const store = await loadStore();
    const older = makeBounty({ id: "BNT-OLD" });
    const newer = makeBounty({ id: "BNT-NEW" });

    const olderTemp = storeTempPath("bounties.json", 5);
    const newerTemp = storeTempPath("bounties.json", 6);
    fs.writeFileSync(olderTemp, JSON.stringify([older]));
    fs.writeFileSync(newerTemp, JSON.stringify([newer]));
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(olderTemp, past, past);

    const summary = store.resumeInterruptedStoreWrites();
    expect(summary.completed).toHaveLength(1);
    expect(summary.discarded.length).toBeGreaterThanOrEqual(1);

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[];
    expect(raw.map((r) => r.id)).toEqual(["BNT-NEW"]);
  });

  it("discards a temp older than the committed target", async () => {
    const store = await loadStore();
    fs.writeFileSync(storeFile, JSON.stringify([makeBounty({ id: "BNT-CURRENT" })]), "utf8");
    const tempPath = storeTempPath("bounties.json", 7);
    fs.writeFileSync(tempPath, JSON.stringify([makeBounty({ id: "BNT-STALE" })]));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(storeFile, future, future);

    const summary = store.resumeInterruptedStoreWrites();
    expect(summary.completed).toHaveLength(0);
    expect(summary.discarded).toHaveLength(1);

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[];
    expect(raw[0].id).toBe("BNT-CURRENT");
  });
});

describe("SBB-2026-453 — validate JSON bounty store write input", () => {
  it("rejects non-array bounty payloads", async () => {
    const store = await loadStore();
    expect(() => store.validateBountyRecordsForWrite({ nope: true })).toThrow(
      /must be an array/
    );
  });

  it("rejects records with invalid status, negative amount, and bad labels", async () => {
    const store = await loadStore();
    const base = makeBounty();

    expect(() =>
      store.validateBountyRecordsForWrite([{ ...base, status: "bogus" as never }])
    ).toThrow(/not a valid bounty status/);
    expect(() =>
      store.validateBountyRecordsForWrite([{ ...base, amount: -1 }])
    ).toThrow(/non-negative finite number/);
    expect(() =>
      store.validateBountyRecordsForWrite([{ ...base, labels: "x" as never }])
    ).toThrow(/labels must be an array/);
    expect(() =>
      store.validateBountyRecordsForWrite([{ ...base, issueNumber: 0 }])
    ).toThrow(/positive integer/);
  });

  it("accepts legacy records missing tokenAddress/version/events", async () => {
    const store = await loadStore();
    const legacy = makeBounty() as Record<string, unknown>;
    delete legacy.tokenAddress;
    delete legacy.version;
    delete legacy.events;
    expect(() => store.validateBountyRecordsForWrite([legacy])).not.toThrow();
  });

  it("rejects malformed audit records", async () => {
    const store = await loadStore();
    const valid = {
      id: "AUD-1",
      bountyId: "BNT-1",
      fromStatus: "open",
      toStatus: "reserved",
      transition: "reserve",
      actor: CONTRIBUTOR,
      timestamp: 1,
    };
    expect(() => store.validateAuditRecordsForWrite([valid])).not.toThrow();
    expect(() =>
      store.validateAuditRecordsForWrite([{ ...valid, toStatus: "bogus" }])
    ).toThrow(/not a valid bounty status/);
    expect(() =>
      store.validateAuditRecordsForWrite([{ ...valid, transition: "bogus" }])
    ).toThrow(/not a valid transition type/);
    expect(() =>
      store.validateAuditRecordsForWrite([{ ...valid, metadata: { bad: { nested: 1 } } }])
    ).toThrow(/must be a string, finite number, boolean, or null/);
  });
});

describe("SBB-2026-454 — trace JSON bounty store write outcomes", () => {
  it("emits pending/committed write traces for store and audit writes", async () => {
    const traces: StoreWriteTraceRecord[] = [];
    setGlobalStoreWriteTraceSink((record) => traces.push(record));
    const store = await loadStore();

    const created = await store.createBounty({
      repo: "acme/widget",
      issueNumber: 3,
      title: "Traced bounty",
      summary: "Write tracing coverage for the JSON store.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 5,
      deadlineDays: 7,
      labels: [],
    });

    const bountyWrites = traces.filter((t) => t.store === "bounties");
    expect(bountyWrites.some((t) => t.outcome === "pending")).toBe(true);
    const committed = bountyWrites.find((t) => t.outcome === "committed");
    expect(committed).toBeDefined();
    expect(committed!.event).toBe(STORE_WRITE_TRACE_EVENT);
    expect(committed!.recordCount).toBeGreaterThanOrEqual(1);
    expect(committed!.bytes).toBeGreaterThan(0);
    expect(committed!.resumed).toBe(false);
    expect(created.id).toMatch(/^BNT-/);
  });

  it("marks resumed writes in the trace record", async () => {
    const traces: StoreWriteTraceRecord[] = [];
    setGlobalStoreWriteTraceSink((record) => traces.push(record));
    const store = await loadStore();

    fs.writeFileSync(
      storeTempPath("bounties.json", 8),
      JSON.stringify([makeBounty({ id: "BNT-RESUMED" })])
    );
    store.resumeInterruptedStoreWrites();

    const resumed = traces.find((t) => t.resumed === true && t.outcome === "committed");
    expect(resumed).toBeDefined();
    expect(resumed!.store).toBe("bounties");
    expect(resumed!.reason).toBe("interrupted_write_resumed");
  });
});

describe("SBB-2026-457 — resume concurrent bounty state update after interruption", () => {
  it("applies a pending state update before the next transition under the store lock", async () => {
    const store = await loadStore();
    const bounty = await store.createBounty({
      repo: "acme/widget",
      issueNumber: 9,
      title: "Interrupted concurrent update",
      summary: "A reservation whose store write was interrupted mid-flight.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 42,
      deadlineDays: 14,
      labels: [],
    });

    // Simulate the process dying after the temp write but before the rename:
    // the pending payload already contains the reserved transition at v2.
    const reserved: BountyRecord = {
      ...bounty,
      contributor: CONTRIBUTOR,
      status: "reserved",
      reservedAt: Math.floor(Date.now() / 1000),
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "reserved", timestamp: Math.floor(Date.now() / 1000), actor: CONTRIBUTOR },
      ],
    };
    // The pending snapshot must include every record, not just the changed one.
    const pendingRecords = (JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[]).map(
      (record) => (record.id === bounty.id ? reserved : record)
    );
    fs.writeFileSync(storeTempPath("bounties.json", 9), JSON.stringify(pendingRecords, null, 2));

    // The next concurrent state update resumes the interrupted write inside the
    // lock, then sees the reserved status instead of the stale open record.
    await expect(store.reserveBounty(bounty.id, CONTRIBUTOR)).rejects.toThrow(/only open/i);

    const after = store.listBounties().find((record) => record.id === bounty.id);
    expect(after?.status).toBe("reserved");
    expect(after?.version).toBe(bounty.version + 1);
    expect(after?.contributor).toBe(CONTRIBUTOR);
  });
});
