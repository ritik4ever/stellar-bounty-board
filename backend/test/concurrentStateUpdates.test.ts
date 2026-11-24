import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, validCreateBody } from "./fixtures";

/**
 * Concurrent state update boundary (Issue #1925).
 *
 * A reserve and a refund may reach the store at the same version. These tests
 * pin the defined outcome: exactly one legal transition commits, the record's
 * version advances exactly once, and the losing writer is told why (400 when it
 * supplied no version, 409 with the current version when it did).
 */

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `concurrent-state-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  for (const file of [storeFile, storeFile.replace(/\.json$/i, ".audit.json")]) {
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

type Store = Awaited<ReturnType<typeof loadStore>>;

async function createOpenBounty(store: Store, issueNumber = 77) {
  return store.createBounty({
    repo: "owner/repo-name",
    issueNumber,
    title: "Concurrent state boundary",
    summary: "Reserve and refund racing at the same record version.",
    maintainer: MAINTAINER,
    tokenSymbol: "XLM",
    amount: 100,
    deadlineDays: 14,
    labels: [],
  });
}

function readRecord(id: string) {
  const records = JSON.parse(fs.readFileSync(storeFile, "utf8")) as Array<{
    id: string;
    status: string;
    version: number;
    events: Array<{ type: string }>;
  }>;
  return records.find((record) => record.id === id)!;
}

describe("reserve/refund at the same version — store boundary", () => {
  it("serializes concurrent writes without losing an update and keeps versions monotonic", async () => {
    const store = await loadStore();
    const bounty = await createOpenBounty(store);

    const [reserve, refund] = await Promise.allSettled([
      store.reserveBounty(bounty.id, CONTRIBUTOR),
      store.refundBounty(bounty.id, MAINTAINER, "a".repeat(64)),
    ]);

    // Both transitions are individually legal from the state the winner leaves
    // behind (a reservation may be refunded before submission), so either one or
    // both may commit — but each committed transition advances the version by
    // exactly one, and no committed write is overwritten.
    const committed = [reserve, refund].filter((outcome) => outcome.status === "fulfilled");
    expect(committed.length).toBeGreaterThanOrEqual(1);

    const after = readRecord(bounty.id);
    expect(after.status).toBe("refunded");
    expect(after.version).toBe(bounty.version + committed.length);
    expect(after.events.filter((event) => event.type === "refunded")).toHaveLength(1);
    expect(after.events.filter((event) => event.type === "reserved")).toHaveLength(
      committed.length === 2 ? 1 : 0
    );
    expect(after.events).toHaveLength(1 + committed.length);
  });

  it("commits exactly one transition when both callers pin the same expectedVersion", async () => {
    const store = await loadStore();
    const bounty = await createOpenBounty(store);

    const [reserve, refund] = await Promise.allSettled([
      store.reserveBounty(bounty.id, CONTRIBUTOR, bounty.version),
      store.refundBounty(bounty.id, MAINTAINER, undefined, bounty.version),
    ]);

    const outcomes = [reserve, refund];
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);

    const loser = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
    )!;
    expect(loser.reason).toMatchObject({
      code: "BOUNTY_VERSION_CONFLICT",
      currentVersion: bounty.version + 1,
    });

    const after = readRecord(bounty.id);
    expect(after.version).toBe(bounty.version + 1);
    expect(["reserved", "refunded"]).toContain(after.status);
    // created + the single winning transition; no duplicated side effects.
    expect(after.events).toHaveLength(2);
  });

  it("rejects a refund whose expectedVersion lost to a reservation with a typed 409", async () => {
    const store = await loadStore();
    const { BountyTransitionConflictError } = await import("../src/services/errors");
    const bounty = await createOpenBounty(store);
    const reserved = await store.reserveBounty(bounty.id, CONTRIBUTOR);

    await expect(
      store.refundBounty(bounty.id, MAINTAINER, undefined, bounty.version)
    ).rejects.toMatchObject({
      name: "BountyTransitionConflictError",
      code: "BOUNTY_VERSION_CONFLICT",
      statusCode: 409,
      currentVersion: reserved.version,
      currentStatus: "reserved",
    });

    expect(BountyTransitionConflictError).toBeDefined();

    const after = readRecord(bounty.id);
    expect(after.status).toBe("reserved");
    expect(after.version).toBe(reserved.version);
    expect(after.events.some((event) => event.type === "refunded")).toBe(false);
  });

  it("rejects a reserve whose expectedVersion lost to a refund", async () => {
    const store = await loadStore();
    const bounty = await createOpenBounty(store);

    const refunded = await store.refundBounty(bounty.id, MAINTAINER);

    await expect(
      store.reserveBounty(bounty.id, CONTRIBUTOR, bounty.version)
    ).rejects.toMatchObject({
      name: "BountyTransitionConflictError",
      code: "BOUNTY_VERSION_CONFLICT",
      currentVersion: refunded.version,
      currentStatus: "refunded",
    });

    const after = readRecord(bounty.id);
    expect(after.status).toBe("refunded");
    expect(after.version).toBe(refunded.version);
  });

  it("accepts a retry once the caller refreshes to the current version", async () => {
    const store = await loadStore();
    const bounty = await createOpenBounty(store);
    const reserved = await store.reserveBounty(bounty.id, CONTRIBUTOR);

    const refunded = await store.refundBounty(bounty.id, MAINTAINER, undefined, reserved.version);

    expect(refunded.status).toBe("refunded");
    expect(refunded.version).toBe(reserved.version + 1);
  });
});

describe("reserve/refund at the same version — HTTP boundary", () => {
  it("answers simultaneous reserve requests with one 200 and defined conflicts, never 503", async () => {
    const { app } = await import("../src/app");

    const created = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.body.data.id as string;

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR })
      )
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 400 || status === 409)).toHaveLength(7);
    expect(statuses).not.toContain(503);

    const fetched = await request(app).get(`/api/bounties/${id}`).expect(200);
    expect(fetched.body.data.status).toBe("reserved");
    expect(fetched.body.data.version).toBe(2);
  });

  it("returns 409 with the current version when a refund's expectedVersion is stale", async () => {
    const { app } = await import("../src/app");

    const created = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.body.data.id as string;
    const versionRead = created.body.data.version as number;

    const refunded = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .send({ maintainer: MAINTAINER, expectedVersion: versionRead })
      .expect(200);
    expect(refunded.body.data.version).toBe(versionRead + 1);

    const stale = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .send({ maintainer: MAINTAINER, expectedVersion: versionRead })
      .expect(409);

    expect(stale.body).toMatchObject({
      code: "BOUNTY_VERSION_CONFLICT",
      currentVersion: versionRead + 1,
      currentStatus: "refunded",
    });

    const fetched = await request(app).get(`/api/bounties/${id}`).expect(200);
    expect(fetched.body.data.status).toBe("refunded");
    expect(fetched.body.data.version).toBe(versionRead + 1);
  });

  it("rejects a non-numeric expectedVersion before touching the store", async () => {
    const { app } = await import("../src/app");

    const created = await request(app).post("/api/bounties").send(validCreateBody).expect(201);

    await request(app)
      .post(`/api/bounties/${created.body.data.id}/refund`)
      .send({ maintainer: MAINTAINER, expectedVersion: "1" })
      .expect(400);
  });
});

describe("worker boundary — reservation expiry", () => {
  it("advances the version once so a stale refund is rejected instead of overwriting", async () => {
    const store = await loadStore();
    const now = Math.floor(Date.now() / 1000);
    const stale = {
      id: "BNT-WORKER-001",
      repo: "owner/repo-name",
      issueNumber: 5,
      title: "Stale reservation",
      summary: "Reserved long ago and overdue for expiry.",
      maintainer: MAINTAINER,
      contributor: CONTRIBUTOR,
      tokenSymbol: "XLM",
      tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
      amount: 100,
      labels: [],
      status: "reserved" as const,
      createdAt: now - 9 * 24 * 60 * 60,
      deadlineAt: now + 9999999,
      reservedAt: now - 8 * 24 * 60 * 60,
      version: 1,
      events: [
        { type: "created" as const, timestamp: now - 9 * 24 * 60 * 60 },
        { type: "reserved" as const, timestamp: now - 8 * 24 * 60 * 60, actor: CONTRIBUTOR },
      ],
      reservationTimeoutSeconds: 999999999,
    };
    fs.writeFileSync(storeFile, JSON.stringify([stale], null, 2));

    const result = await store.expireStaleReservations(7 * 24 * 60 * 60);
    expect(result.expiredBountyIds).toEqual([stale.id]);

    const expired = readRecord(stale.id);
    expect(expired.status).toBe("open");
    expect(expired.version).toBe(2);

    await expect(store.refundBounty(stale.id, MAINTAINER, undefined, 1)).rejects.toMatchObject({
      code: "BOUNTY_VERSION_CONFLICT",
      currentVersion: 2,
    });

    const refunded = await store.refundBounty(stale.id, MAINTAINER, undefined, 2);
    expect(refunded.version).toBe(3);
    expect(refunded.status).toBe("refunded");
  });

  it("never overwrites a refund that committed while the worker was running", async () => {
    const store = await loadStore();
    const now = Math.floor(Date.now() / 1000);
    const stale = {
      id: "BNT-WORKER-002",
      repo: "owner/repo-name",
      issueNumber: 6,
      title: "Stale reservation racing a refund",
      summary: "Expiry worker and a refund contend for the same record.",
      maintainer: MAINTAINER,
      contributor: CONTRIBUTOR,
      tokenSymbol: "XLM",
      tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
      amount: 100,
      labels: [],
      status: "reserved" as const,
      createdAt: now - 9 * 24 * 60 * 60,
      deadlineAt: now + 9999999,
      reservedAt: now - 8 * 24 * 60 * 60,
      version: 1,
      events: [
        { type: "created" as const, timestamp: now - 9 * 24 * 60 * 60 },
        { type: "reserved" as const, timestamp: now - 8 * 24 * 60 * 60, actor: CONTRIBUTOR },
      ],
      reservationTimeoutSeconds: 999999999,
    };
    fs.writeFileSync(storeFile, JSON.stringify([stale], null, 2));

    const [refund] = await Promise.allSettled([
      store.refundBounty(stale.id, MAINTAINER),
      store.expireStaleReservations(7 * 24 * 60 * 60),
    ]);

    const after = readRecord(stale.id);

    if (refund.status === "fulfilled") {
      // Whichever won, exactly one refund event exists and the version never
      // goes backwards or repeats.
      expect(after.status).toBe("refunded");
      expect(after.events.filter((event) => event.type === "refunded")).toHaveLength(1);
      expect(after.version).toBeGreaterThanOrEqual(2);
      expect(after.version).toBeLessThanOrEqual(3);
    } else {
      expect(after.status).toBe("open");
      expect(after.version).toBe(2);
    }
  });
});
