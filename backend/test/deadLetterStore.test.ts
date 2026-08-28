import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let deadLetterFile: string;
let storeFile: string;

function removeFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best effort
  }
}

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function getDeadLetterStore() {
  return import("../src/services/deadLetterStore");
}

describe("Dead-Letter Store", () => {
  beforeEach(() => {
    deadLetterFile = path.join(os.tmpdir(), `dead-letter-${randomUUID()}.json`);
    storeFile = path.join(os.tmpdir(), `bounty-dl-test-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, "[]", "utf8");
    process.env.DEAD_LETTER_STORE_PATH = deadLetterFile;
    process.env.BOUNTY_STORE_PATH = storeFile;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DEAD_LETTER_STORE_PATH;
    delete process.env.BOUNTY_STORE_PATH;
    removeFileIfExists(deadLetterFile);
    removeFileIfExists(storeFile);
    removeFileIfExists(storeFile.replace(/\.json$/i, ".audit.json"));
  });

  it("dead-letterEvent creates a record with correct structure", async () => {
    const { deadLetterEvent } = await getDeadLetterStore();
    const rawEvent = { id: "evt-1", type: "create", bounty_id: "BNT-0001" };
    const errorMessage = "Processing failed: invalid payload";

    const result = deadLetterEvent(rawEvent, errorMessage);

    expect(result.id).toMatch(/^DL-\d{6}$/);
    expect(result.rawEvent).toEqual(rawEvent);
    expect(result.errorMessage).toBe(errorMessage);
    expect(result.replayCount).toBe(0);
    expect(result.lastReplayedAt).toBeNull();
    expect(result.status).toBe("pending");
    expect(result.replayHistory).toEqual([]);
    expect(result.createdAt).toBeDefined();
  });

  it("dead-letterEvent persists to file", async () => {
    const { deadLetterEvent } = await getDeadLetterStore();
    const rawEvent = { id: "evt-2", type: "reserve" };

    deadLetterEvent(rawEvent, "test error");

    expect(fs.existsSync(deadLetterFile)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(deadLetterFile, "utf8"));
    expect(stored).toHaveLength(1);
    expect(stored[0].rawEvent).toEqual(rawEvent);
  });

  it("listDeadLetterEvents returns all events", async () => {
    const { deadLetterEvent, listDeadLetterEvents } = await getDeadLetterStore();

    deadLetterEvent({ id: "evt-1" }, "error 1");
    deadLetterEvent({ id: "evt-2" }, "error 2");

    const result = listDeadLetterEvents();
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("listDeadLetterEvents filters by status", async () => {
    const { deadLetterEvent, listDeadLetterEvents, recordReplayAttempt, markReplaySuccess } =
      await getDeadLetterStore();

    deadLetterEvent({ id: "evt-1" }, "error 1");
    const evt2 = deadLetterEvent({ id: "evt-2" }, "error 2");
    deadLetterEvent({ id: "evt-3" }, "error 3");

    // Mark evt2 as replayed
    recordReplayAttempt(evt2.id);
    markReplaySuccess(evt2.id);

    const pending = listDeadLetterEvents({ status: "pending" });
    expect(pending.data).toHaveLength(2);

    const replayed = listDeadLetterEvents({ status: "replayed" });
    expect(replayed.data).toHaveLength(1);
    expect(replayed.data[0].id).toBe(evt2.id);
  });

  it("listDeadLetterEvents supports pagination", async () => {
    const { deadLetterEvent, listDeadLetterEvents } = await getDeadLetterStore();

    for (let i = 0; i < 5; i++) {
      deadLetterEvent({ id: `evt-${i}` }, `error ${i}`);
    }

    const page1 = listDeadLetterEvents({ limit: 2, offset: 0 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = listDeadLetterEvents({ limit: 2, offset: 2 });
    expect(page2.data).toHaveLength(2);

    const page3 = listDeadLetterEvents({ limit: 2, offset: 4 });
    expect(page3.data).toHaveLength(1);
  });

  it("getDeadLetterEvent returns event by ID", async () => {
    const { deadLetterEvent, getDeadLetterEvent } = await getDeadLetterStore();

    const evt = deadLetterEvent({ id: "evt-1" }, "error");

    const found = getDeadLetterEvent(evt.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(evt.id);
  });

  it("getDeadLetterEvent returns undefined for non-existent ID", async () => {
    const { getDeadLetterEvent } = await getDeadLetterStore();

    const found = getDeadLetterEvent("DL-999999");
    expect(found).toBeUndefined();
  });

  it("recordReplayAttempt increments replay count", async () => {
    const { deadLetterEvent, recordReplayAttempt } = await getDeadLetterStore();

    const evt = deadLetterEvent({ id: "evt-1" }, "error");

    const updated = recordReplayAttempt(evt.id);
    expect(updated).toBeDefined();
    expect(updated?.replayCount).toBe(1);
    expect(updated?.lastReplayedAt).toBeDefined();

    const updated2 = recordReplayAttempt(evt.id);
    expect(updated2?.replayCount).toBe(2);
  });

  it("recordReplayAttempt exhausts after MAX_REPLAY_ATTEMPTS", async () => {
    const { deadLetterEvent, recordReplayAttempt } = await getDeadLetterStore();

    const evt = deadLetterEvent({ id: "evt-1" }, "error");

    // 5 attempts to reach exhaustion (MAX_REPLAY_ATTEMPTS = 5)
    for (let i = 0; i < 5; i++) {
      const result = recordReplayAttempt(evt.id);
      if (i < 4) {
        expect(result?.status).toBe("pending");
      } else {
        expect(result?.status).toBe("exhausted");
      }
    }
  });

  it("markReplaySuccess sets status to replayed", async () => {
    const { deadLetterEvent, recordReplayAttempt, markReplaySuccess } = await getDeadLetterStore();

    const evt = deadLetterEvent({ id: "evt-1" }, "error");
    recordReplayAttempt(evt.id);

    const updated = markReplaySuccess(evt.id);
    expect(updated?.status).toBe("replayed");
    expect(updated?.replayHistory).toHaveLength(1);
    expect(updated?.replayHistory[0].success).toBe(true);
  });

  it("markReplaySuccess with error sets status to failed", async () => {
    const { deadLetterEvent, recordReplayAttempt, markReplaySuccess } = await getDeadLetterStore();

    const evt = deadLetterEvent({ id: "evt-1" }, "error");
    recordReplayAttempt(evt.id);

    const updated = markReplaySuccess(evt.id, "still broken");
    expect(updated?.status).toBe("failed");
    expect(updated?.replayHistory[0].success).toBe(false);
    expect(updated?.replayHistory[0].error).toBe("still broken");
  });

  it("purgeReplayedEvents removes replayed events", async () => {
    const {
      deadLetterEvent,
      recordReplayAttempt,
      markReplaySuccess,
      purgeReplayedEvents,
      listDeadLetterEvents,
    } = await getDeadLetterStore();

    deadLetterEvent({ id: "evt-1" }, "error 1");
    const evt2 = deadLetterEvent({ id: "evt-2" }, "error 2");
    deadLetterEvent({ id: "evt-3" }, "error 3");

    // Mark evt2 as replayed
    recordReplayAttempt(evt2.id);
    markReplaySuccess(evt2.id);

    const removed = purgeReplayedEvents();
    expect(removed).toBe(1);

    const remaining = listDeadLetterEvents();
    expect(remaining.data).toHaveLength(2);
    expect(remaining.data.every((e) => e.status !== "replayed")).toBe(true);
  });

  it("getDeadLetterMetrics returns correct counts", async () => {
    const { deadLetterEvent, recordReplayAttempt, markReplaySuccess, getDeadLetterMetrics } =
      await getDeadLetterStore();

    deadLetterEvent({ id: "evt-1" }, "error 1");
    const evt2 = deadLetterEvent({ id: "evt-2" }, "error 2");
    deadLetterEvent({ id: "evt-3" }, "error 3");

    recordReplayAttempt(evt2.id);
    markReplaySuccess(evt2.id);

    const metrics = getDeadLetterMetrics();
    expect(metrics.total).toBe(3);
    expect(metrics.pending).toBe(2);
    expect(metrics.replayed).toBe(1);
    expect(metrics.failed).toBe(0);
    expect(metrics.exhausted).toBe(0);
  });
});

describe("Dead-Letter Admin API", () => {
  beforeEach(() => {
    deadLetterFile = path.join(os.tmpdir(), `dead-letter-api-${randomUUID()}.json`);
    storeFile = path.join(os.tmpdir(), `bounty-dl-api-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, "[]", "utf8");
    process.env.DEAD_LETTER_STORE_PATH = deadLetterFile;
    process.env.BOUNTY_STORE_PATH = storeFile;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DEAD_LETTER_STORE_PATH;
    delete process.env.BOUNTY_STORE_PATH;
    removeFileIfExists(deadLetterFile);
    removeFileIfExists(storeFile);
    removeFileIfExists(storeFile.replace(/\.json$/i, ".audit.json"));
  });

  it("GET /api/admin/dead-letter returns empty list initially", { timeout: 30000 }, async () => {
    const app = await getApp();
    const res = await request(app)
      .get("/api/admin/dead-letter")
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("GET /api/admin/dead-letter returns dead-lettered events", async () => {
    const { deadLetterEvent } = await getDeadLetterStore();
    deadLetterEvent({ id: "evt-1", type: "create" }, "error 1");
    deadLetterEvent({ id: "evt-2", type: "reserve" }, "error 2");

    const app = await getApp();
    const res = await request(app)
      .get("/api/admin/dead-letter")
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it("GET /api/admin/dead-letter filters by status", async () => {
    const { deadLetterEvent, recordReplayAttempt, markReplaySuccess } = await getDeadLetterStore();

    deadLetterEvent({ id: "evt-1" }, "error 1");
    const evt2 = deadLetterEvent({ id: "evt-2" }, "error 2");
    recordReplayAttempt(evt2.id);
    markReplaySuccess(evt2.id);

    const app = await getApp();
    const res = await request(app)
      .get("/api/admin/dead-letter?status=replayed")
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("replayed");
  });

  it("GET /api/admin/dead-letter/metrics returns metrics", async () => {
    const { deadLetterEvent } = await getDeadLetterStore();
    deadLetterEvent({ id: "evt-1" }, "error 1");

    const app = await getApp();
    const res = await request(app)
      .get("/api/admin/dead-letter/metrics")
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.pending).toBe(1);
  });

  it("GET /api/admin/dead-letter/:id returns a specific event", async () => {
    const { deadLetterEvent } = await getDeadLetterStore();
    const evt = deadLetterEvent({ id: "evt-1" }, "error 1");

    const app = await getApp();
    const res = await request(app)
      .get(`/api/admin/dead-letter/${evt.id}`)
      .expect(200);

    expect(res.body.data.id).toBe(evt.id);
    expect(res.body.data.errorMessage).toBe("error 1");
  });

  it("GET /api/admin/dead-letter/:id returns 404 for non-existent event", async () => {
    const app = await getApp();
    await request(app)
      .get("/api/admin/dead-letter/DL-999999")
      .expect(404);
  });

  it("POST /api/admin/dead-letter/:id/replay replays a pending event", async () => {
    const { deadLetterEvent } = await getDeadLetterStore();
    const evt = deadLetterEvent({ id: "evt-1", type: "create" }, "error 1");

    const app = await getApp();
    const res = await request(app)
      .post(`/api/admin/dead-letter/${evt.id}/replay`)
      .expect(200);

    expect(res.body.data.message).toBe("Event replayed successfully.");
    expect(res.body.data.event.status).toBe("replayed");
  });

  it("POST /api/admin/dead-letter/:id/replay returns 404 for non-existent event", async () => {
    const app = await getApp();
    await request(app)
      .post("/api/admin/dead-letter/DL-999999/replay")
      .expect(404);
  });

  it("POST /api/admin/dead-letter/:id/replay rejects exhausted events", async () => {
    const { deadLetterEvent, recordReplayAttempt } = await getDeadLetterStore();
    const evt = deadLetterEvent({ id: "evt-1" }, "error 1");

    // Exhaust the event (5 attempts)
    for (let i = 0; i < 5; i++) {
      recordReplayAttempt(evt.id);
    }

    const app = await getApp();
    const res = await request(app)
      .post(`/api/admin/dead-letter/${evt.id}/replay`)
      .expect(400);

    expect(res.body.error).toContain("exhausted");
  });

  it("POST /api/admin/dead-letter/purge removes replayed events", async () => {
    const { deadLetterEvent, recordReplayAttempt, markReplaySuccess } = await getDeadLetterStore();

    deadLetterEvent({ id: "evt-1" }, "error 1");
    const evt2 = deadLetterEvent({ id: "evt-2" }, "error 2");
    recordReplayAttempt(evt2.id);
    markReplaySuccess(evt2.id);

    const app = await getApp();
    const res = await request(app)
      .post("/api/admin/dead-letter/purge")
      .expect(200);

    expect(res.body.data.removed).toBe(1);

    // Verify only non-replayed events remain
    const listRes = await request(app)
      .get("/api/admin/dead-letter")
      .expect(200);

    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].id).not.toBe(evt2.id);
  });
});
