import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BountyRecord, BountyStatus } from "../src/services/bountyStore";
import type { CacheAdapter } from "../src/services/cache";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT } from "./fixtures";

// Bypass the live GitHub API existence check so submission flows are fully
// deterministic and offline while still exercising bountyStore transitions.
vi.mock("../src/validation/prUrl", async () => {
  const actual = await vi.importActual<typeof import("../src/validation/prUrl")>(
    "../src/validation/prUrl",
  );
  return {
    ...actual,
    validateGithubPrUrlForRepo: vi.fn(async () => undefined),
  };
});

// Capture notification dispatches so we can assert event types and payloads
// (this pins down the notification blocks against mutation) without any network.
const sendNotificationMock = vi.fn(async () => undefined);
vi.mock("../src/services/notificationService", () => ({
  sendNotification: sendNotificationMock,
}));

/** Return the payload object of the notification dispatched for `eventType`. */
function notificationPayload(eventType: string): Record<string, unknown> | undefined {
  const call = sendNotificationMock.mock.calls.find((c) => c[1] === eventType);
  return call?.[2] as Record<string, unknown> | undefined;
}

const PR_URL = "https://github.com/acme/widget/pull/1";
const THIRD_ACCOUNT = "GAFQ647SLVQP5J3EIJGY4XARG4SPK2RMRNYPV7YYEIEUPGBMP6467B6E";

let storeFile: string;
let auditFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-mut-${randomUUID()}.json`);
  auditFile = storeFile.replace(/\.json$/i, ".audit.json");
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  delete process.env.ARBITER_ADDRESS;
  sendNotificationMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.ARBITER_ADDRESS;
  for (const file of [storeFile, auditFile]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort temp cleanup */
    }
  }
});

async function loadStore() {
  return import("../src/services/bountyStore");
}

/** Write raw bounty records straight to the store file to exercise read paths. */
function writeRecords(records: BountyRecord[]): void {
  fs.writeFileSync(storeFile, JSON.stringify(records, null, 2), "utf8");
}

let recordCounter = 0;
/** Build a fully-populated, valid open bounty record with overrides. */
function makeRecord(overrides: Partial<BountyRecord> = {}): BountyRecord {
  recordCounter += 1;
  const createdAt = 1_700_000_000 + recordCounter;
  return {
    id: `BNT-${String(recordCounter).padStart(4, "0")}`,
    repo: "acme/widget",
    issueNumber: recordCounter,
    title: `Bounty number ${recordCounter} with a long enough title`,
    summary: `Summary for bounty ${recordCounter} that is comfortably long.`,
    maintainer: MAINTAINER,
    tokenSymbol: "USDC",
    tokenAddress: "CCW677VKUVRVH25WJ3G7L2NKV6AEFBSFW4FG7L0XXXXXX",
    amount: 100,
    labels: [],
    status: "open",
    createdAt,
    deadlineAt: 9_000_000_000,
    version: 1,
    events: [{ type: "created", timestamp: createdAt }],
    reservationTimeoutSeconds: 604800,
    ...overrides,
  };
}

/** A minimal in-memory CacheAdapter with spies for the cached read paths. */
function makeFakeCache(): CacheAdapter & {
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

async function createOpen(
  overrides: Record<string, unknown> = {},
): Promise<BountyRecord> {
  const { createBounty } = await loadStore();
  return createBounty({
    repo: "acme/widget",
    issueNumber: 1,
    title: "A sufficiently descriptive bounty title here",
    summary: "A summary that comfortably exceeds twenty characters in length.",
    maintainer: MAINTAINER,
    tokenSymbol: "usdc",
    amount: 100,
    deadlineDays: 14,
    labels: [],
    ...overrides,
  } as never);
}

// ─────────────────────────────────────────────────────────────────────────────
describe("createBounty — field derivation", () => {
  it("uppercases token symbol, rounds amount to 2dp, and defaults timeout", async () => {
    const created = await createOpen({
      tokenSymbol: "usdc",
      amount: 42.559,
      deadlineDays: 2,
    });
    expect(created.tokenSymbol).toBe("USDC");
    expect(created.amount).toBe(42.56);
    expect(created.status).toBe("open");
    expect(created.version).toBe(1);
    expect(created.reservationTimeoutSeconds).toBe(604800);
    // deadlineAt = createdAt + days * 86400
    expect(created.deadlineAt - created.createdAt).toBe(2 * 24 * 60 * 60);
    expect(created.tokenAddress.length).toBeGreaterThan(0);
    expect(created.events).toHaveLength(1);
    expect(created.events[0].type).toBe("created");

    // A bounty_created notification is dispatched to the maintainer.
    const payload = notificationPayload("bounty_created");
    expect(payload).toBeDefined();
    expect(payload?.bountyId).toBe(created.id);
    expect(payload?.maintainer).toBe(MAINTAINER);
    expect(payload?.amount).toBe(created.amount);
    expect(payload?.tokenSymbol).toBe("USDC");
    const call = sendNotificationMock.mock.calls.find((c) => c[1] === "bounty_created");
    expect(call?.[0]).toEqual([{ role: "maintainer", address: MAINTAINER }]);
  });

  it("honours an explicit reservationTimeoutSeconds", async () => {
    const created = await createOpen({ reservationTimeoutSeconds: 120 });
    expect(created.reservationTimeoutSeconds).toBe(120);
  });

  it("assigns incrementing BNT ids", async () => {
    const a = await createOpen({ issueNumber: 1 });
    const b = await createOpen({ issueNumber: 2 });
    expect(a.id).toBe("BNT-0001");
    expect(b.id).toBe("BNT-0002");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("listBounties — filtering", () => {
  beforeEach(() => {
    writeRecords([
      makeRecord({
        id: "BNT-0001",
        title: "Alpha widget fix",
        summary: "Improve rendering",
        labels: ["frontend"],
        maintainer: MAINTAINER,
        contributor: CONTRIBUTOR,
        tokenSymbol: "XLM",
        status: "reserved",
        amount: 10,
        deadlineAt: 5_000,
        createdAt: 100,
      }),
      makeRecord({
        id: "BNT-0002",
        title: "Beta backend task",
        summary: "Zeta special keyword here",
        labels: ["backend", "urgent"],
        maintainer: OTHER_ACCOUNT,
        contributor: THIRD_ACCOUNT,
        tokenSymbol: "USDC",
        status: "open",
        amount: 30,
        deadlineAt: 8_000_000_000,
        createdAt: 200,
      }),
      makeRecord({
        id: "BNT-0003",
        title: "Gamma docs",
        summary: "Documentation only",
        labels: ["docs"],
        maintainer: MAINTAINER,
        tokenSymbol: "USDC",
        status: "released",
        amount: 20,
        deadlineAt: 9_500_000_000,
        createdAt: 300,
      }),
    ]);
  });

  it("matches q against title, summary, and labels (case-insensitive)", async () => {
    const { listBounties } = await loadStore();
    expect(listBounties({ q: "alpha" }).map((b) => b.id)).toEqual(["BNT-0001"]);
    expect(listBounties({ q: "zeta" }).map((b) => b.id)).toEqual(["BNT-0002"]);
    expect(listBounties({ q: "URGENT" }).map((b) => b.id)).toEqual(["BNT-0002"]);
    expect(listBounties({ q: "nomatch" })).toHaveLength(0);
  });

  it("filters by contributor, maintainer, tokenSymbol and status", async () => {
    const { listBounties } = await loadStore();
    expect(listBounties({ contributor: CONTRIBUTOR }).map((b) => b.id)).toEqual([
      "BNT-0001",
    ]);
    expect(
      listBounties({ maintainer: MAINTAINER })
        .map((b) => b.id)
        .sort(),
    ).toEqual(["BNT-0001", "BNT-0003"]);
    expect(listBounties({ tokenSymbol: "usdc" }).map((b) => b.id).sort()).toEqual([
      "BNT-0002",
      "BNT-0003",
    ]);
    expect(listBounties({ status: "released" as BountyStatus }).map((b) => b.id)).toEqual([
      "BNT-0003",
    ]);
  });

  it("filters by deadlineBefore and deadlineAfter (strict comparisons)", async () => {
    const { listBounties } = await loadStore();
    expect(listBounties({ deadlineBefore: 6_000 }).map((b) => b.id)).toEqual([
      "BNT-0001",
    ]);
    // strict: a record whose deadline equals the boundary is excluded
    expect(listBounties({ deadlineBefore: 5_000 })).toHaveLength(0);
    expect(
      listBounties({ deadlineAfter: 9_000_000_000 }).map((b) => b.id),
    ).toEqual(["BNT-0003"]);
    expect(listBounties({ deadlineAfter: 9_500_000_000 })).toHaveLength(0);
  });
});

describe("listBounties — sorting", () => {
  beforeEach(() => {
    writeRecords([
      makeRecord({ id: "BNT-0001", amount: 30, createdAt: 100, deadlineAt: 300, status: "open" }),
      makeRecord({ id: "BNT-0002", amount: 10, createdAt: 200, deadlineAt: 100, status: "released" }),
      makeRecord({ id: "BNT-0003", amount: 20, createdAt: 300, deadlineAt: 200, status: "expired" }),
    ]);
  });

  it("sorts by amount ascending and descending", async () => {
    const { listBounties } = await loadStore();
    expect(listBounties({ sort: "amount", order: "asc" }).map((b) => b.amount)).toEqual([
      10, 20, 30,
    ]);
    expect(listBounties({ sort: "amount", order: "desc" }).map((b) => b.amount)).toEqual([
      30, 20, 10,
    ]);
  });

  it("sorts by deadline", async () => {
    const { listBounties } = await loadStore();
    expect(
      listBounties({ sort: "deadline", order: "asc" }).map((b) => b.deadlineAt),
    ).toEqual([100, 200, 300]);
  });

  it("sorts by status using locale compare", async () => {
    // Future deadlines so the "open" record is not auto-expired by normalize.
    writeRecords([
      makeRecord({ id: "BNT-0001", status: "open", deadlineAt: 9_000_000_000 }),
      makeRecord({ id: "BNT-0002", status: "released", deadlineAt: 9_000_000_000 }),
      makeRecord({ id: "BNT-0003", status: "expired", deadlineAt: 9_000_000_000 }),
    ]);
    const { listBounties } = await loadStore();
    expect(listBounties({ sort: "status", order: "asc" }).map((b) => b.status)).toEqual([
      "expired",
      "open",
      "released",
    ]);
  });

  it("defaults to createdAt descending", async () => {
    const { listBounties } = await loadStore();
    expect(listBounties().map((b) => b.createdAt)).toEqual([300, 200, 100]);
  });

  it("breaks ties by createdAt descending", async () => {
    writeRecords([
      makeRecord({ id: "BNT-0001", amount: 50, createdAt: 100 }),
      makeRecord({ id: "BNT-0002", amount: 50, createdAt: 400 }),
      makeRecord({ id: "BNT-0003", amount: 50, createdAt: 250 }),
    ]);
    const { listBounties } = await loadStore();
    // equal amounts -> newest createdAt first
    expect(listBounties({ sort: "amount", order: "asc" }).map((b) => b.createdAt)).toEqual([
      400, 250, 100,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeRecords — expiration & backward compatibility", () => {
  it("expires an open bounty whose deadline has passed", async () => {
    writeRecords([makeRecord({ id: "BNT-0001", status: "open", deadlineAt: 1_000 })]);
    const { listBounties, listBountyAuditLogs } = await loadStore();
    const [b] = listBounties();
    expect(b.status).toBe("expired");
    expect(b.events.some((e) => e.type === "expired")).toBe(true);
    const audit = listBountyAuditLogs("BNT-0001");
    expect(audit.data.some((l) => l.transition === "expire")).toBe(true);
  });

  it("expires a reserved bounty whose deadline has passed", async () => {
    writeRecords([
      makeRecord({ id: "BNT-0001", status: "reserved", contributor: CONTRIBUTOR, reservedAt: 500, deadlineAt: 1_000 }),
    ]);
    const { listBounties } = await loadStore();
    expect(listBounties()[0].status).toBe("expired");
  });

  it("returns a reserved bounty to open when its reservation times out", async () => {
    writeRecords([
      makeRecord({
        id: "BNT-0001",
        status: "reserved",
        contributor: CONTRIBUTOR,
        reservedAt: 1_000,
        reservationTimeoutSeconds: 10,
        deadlineAt: 9_000_000_000,
      }),
    ]);
    const { listBounties } = await loadStore();
    const [b] = listBounties();
    expect(b.status).toBe("open");
    expect(b.contributor).toBeUndefined();
    expect(b.reservedAt).toBeUndefined();
    expect(
      b.events.some(
        (e) => e.type === "expired" && e.details?.reason === "reservation_timeout",
      ),
    ).toBe(true);
  });

  it("does not expire an open bounty whose deadline is still in the future", async () => {
    writeRecords([makeRecord({ id: "BNT-0001", status: "open", deadlineAt: 9_000_000_000 })]);
    const { listBounties } = await loadStore();
    expect(listBounties()[0].status).toBe("open");
  });

  it("backfills version and reservationTimeoutSeconds for legacy records", async () => {
    writeRecords([
      makeRecord({
        id: "BNT-0001",
        version: 0 as unknown as number,
        reservationTimeoutSeconds: undefined,
        deadlineAt: 9_000_000_000,
      }),
    ]);
    const { listBounties } = await loadStore();
    const [b] = listBounties();
    expect(b.version).toBe(1);
    expect(b.reservationTimeoutSeconds).toBe(604800);
  });

  it("synthesizes a created event for a record missing its events array", async () => {
    writeRecords([
      makeRecord({
        id: "BNT-0001",
        version: 1,
        events: undefined as unknown as BountyRecord["events"],
        createdAt: 1_700_000_123,
        deadlineAt: 9_000_000_000,
      }),
    ]);
    const { listBounties } = await loadStore();
    const [b] = listBounties();
    expect(b.events).toHaveLength(1);
    expect(b.events[0]).toEqual({ type: "created", timestamp: 1_700_000_123 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("lifecycle transitions", () => {
  it("reserveBounty records contributor, bumps version and appends event", async () => {
    const { reserveBounty } = await loadStore();
    const created = await createOpen();
    const reserved = await reserveBounty(created.id, CONTRIBUTOR);
    expect(reserved.status).toBe("reserved");
    expect(reserved.contributor).toBe(CONTRIBUTOR);
    expect(reserved.version).toBe(created.version + 1);
    expect(reserved.reservedAt).toBeDefined();
    const last = reserved.events[reserved.events.length - 1];
    expect(last.type).toBe("reserved");
    expect(last.actor).toBe(CONTRIBUTOR);

    const payload = notificationPayload("bounty_reserved");
    expect(payload?.bountyId).toBe(created.id);
    expect(payload?.contributor).toBe(CONTRIBUTOR);
    const call = sendNotificationMock.mock.calls.find((c) => c[1] === "bounty_reserved");
    expect(call?.[0]).toEqual([{ role: "maintainer", address: MAINTAINER }]);
  });

  it("reserveBounty enforces optimistic version match", async () => {
    const { reserveBounty } = await loadStore();
    const created = await createOpen();
    await expect(reserveBounty(created.id, CONTRIBUTOR, 999)).rejects.toThrow(
      /just reserved by someone else/i,
    );
    // matching version succeeds
    const ok = await reserveBounty(created.id, CONTRIBUTOR, created.version);
    expect(ok.status).toBe("reserved");
  });

  it("submitBounty stores notes and appends a submitted event", async () => {
    const { reserveBounty, submitBounty } = await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    const submitted = await submitBounty(created.id, CONTRIBUTOR, PR_URL, "my notes");
    expect(submitted.status).toBe("submitted");
    expect(submitted.submissionUrl).toBe(PR_URL);
    expect(submitted.notes).toBe("my notes");
    expect(submitted.events[submitted.events.length - 1].type).toBe("submitted");

    const payload = notificationPayload("bounty_submitted");
    expect(payload?.bountyId).toBe(created.id);
    expect(payload?.submissionUrl).toBe(PR_URL);
    expect(payload?.contributor).toBe(CONTRIBUTOR);
  });

  it("releaseBounty trims tx hash and records protocol fee", async () => {
    const { reserveBounty, submitBounty, releaseBounty } = await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, PR_URL);
    const released = await releaseBounty(created.id, MAINTAINER, "  hash123  ", 5);
    expect(released.status).toBe("released");
    expect(released.releasedTxHash).toBe("hash123");
    expect(released.protocolFeeCollected).toBe(5);
    expect(released.releasedAt).toBeDefined();
  });

  it("releaseBounty keeps prior fee when a non-positive fee is supplied", async () => {
    const { reserveBounty, submitBounty, releaseBounty } = await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, PR_URL);
    const released = await releaseBounty(created.id, MAINTAINER, "", 0);
    expect(released.protocolFeeCollected).toBe(0);
    // empty tx hash leaves releasedTxHash undefined
    expect(released.releasedTxHash).toBeUndefined();
  });

  it("refundBounty notifies the contributor and trims tx hash", async () => {
    const { reserveBounty, refundBounty } = await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    const refunded = await refundBounty(created.id, MAINTAINER, "  rhash  ");
    expect(refunded.status).toBe("refunded");
    expect(refunded.refundedTxHash).toBe("rhash");
    expect(refunded.refundedAt).toBeDefined();

    // With a contributor present, a bounty_refunded notification goes to them.
    const call = sendNotificationMock.mock.calls.find((c) => c[1] === "bounty_refunded");
    expect(call?.[0]).toEqual([{ role: "contributor", address: CONTRIBUTOR }]);
    expect((call?.[2] as Record<string, unknown>)?.bountyId).toBe(created.id);
  });

  it("refundBounty on an open bounty sends no refund notification", async () => {
    const { refundBounty } = await loadStore();
    const created = await createOpen();
    await refundBounty(created.id, MAINTAINER);
    expect(
      sendNotificationMock.mock.calls.some((c) => c[1] === "bounty_refunded"),
    ).toBe(false);
  });

  it("cancelBounty transitions an open bounty to refunded with canceledAt", async () => {
    const { cancelBounty } = await loadStore();
    const created = await createOpen();
    const canceled = await cancelBounty(created.id, MAINTAINER, "  chash  ");
    expect(canceled.status).toBe("refunded");
    expect(canceled.canceledTxHash).toBe("chash");
    expect(canceled.canceledAt).toBeDefined();
    expect(canceled.refundedAt).toBeUndefined();
    const last = canceled.events[canceled.events.length - 1];
    expect(last.details?.reason).toBe("canceled");
  });

  it("updateBountyNotes updates notes without changing status", async () => {
    const { updateBountyNotes } = await loadStore();
    const created = await createOpen();
    const updated = await updateBountyNotes(created.id, MAINTAINER, "reviewer note");
    expect(updated.notes).toBe("reviewer note");
    expect(updated.status).toBe("open");
    expect(updated.version).toBe(created.version + 1);
  });

  it("updateBountyNotes rejects a non-maintainer", async () => {
    const { updateBountyNotes } = await loadStore();
    const created = await createOpen();
    await expect(
      updateBountyNotes(created.id, OTHER_ACCOUNT, "x"),
    ).rejects.toThrow(/maintainer address/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("dispute flow", () => {
  async function seedSubmitted() {
    const { reserveBounty, submitBounty } = await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, PR_URL);
    return created.id;
  }

  it("disputeBounty requires submitted status and the submitting contributor", async () => {
    const { disputeBounty } = await loadStore();
    const open = await createOpen();
    await expect(disputeBounty(open.id, CONTRIBUTOR, "bad")).rejects.toThrow(
      /only submitted/i,
    );

    const id = await seedSubmitted();
    await expect(disputeBounty(id, OTHER_ACCOUNT, "bad")).rejects.toThrow(
      /contributor who submitted/i,
    );
  });

  it("disputeBounty transitions to disputed and records the reason", async () => {
    const { disputeBounty } = await loadStore();
    const id = await seedSubmitted();
    const disputed = await disputeBounty(id, CONTRIBUTOR, "work not reviewed");
    expect(disputed.status).toBe("disputed");
    expect(disputed.disputeReason).toBe("work not reviewed");
    expect(disputed.disputedAt).toBeDefined();
    const last = disputed.events[disputed.events.length - 1];
    expect(last.type).toBe("disputed");
    expect(last.details?.reason).toBe("work not reviewed");

    const call = sendNotificationMock.mock.calls.find((c) => c[1] === "bounty_disputed");
    expect(call?.[0]).toEqual([
      { role: "maintainer", address: MAINTAINER },
      { role: "contributor", address: CONTRIBUTOR },
    ]);
    const payload = call?.[2] as Record<string, unknown>;
    expect(payload?.contributor).toBe(CONTRIBUTOR);
    expect(payload?.reason).toBe("work not reviewed");
  });

  it("resolveDisputeBounty release=true marks released with tx hash", async () => {
    const { disputeBounty, resolveDisputeBounty } = await loadStore();
    const id = await seedSubmitted();
    await disputeBounty(id, CONTRIBUTOR, "reason");
    const resolved = await resolveDisputeBounty(id, MAINTAINER, true, "  txwin  ");
    expect(resolved.status).toBe("released");
    expect(resolved.releasedAt).toBeDefined();
    expect(resolved.releasedTxHash).toBe("txwin");
    expect(resolved.refundedAt).toBeUndefined();
    expect(resolved.events[resolved.events.length - 1].details?.resolution).toBe(
      "released",
    );
  });

  it("resolveDisputeBounty release=false marks refunded with tx hash", async () => {
    const { disputeBounty, resolveDisputeBounty } = await loadStore();
    const id = await seedSubmitted();
    await disputeBounty(id, CONTRIBUTOR, "reason");
    const resolved = await resolveDisputeBounty(id, MAINTAINER, false, "txlose");
    expect(resolved.status).toBe("refunded");
    expect(resolved.refundedAt).toBeDefined();
    expect(resolved.refundedTxHash).toBe("txlose");
    expect(resolved.releasedAt).toBeUndefined();
  });

  it("resolveDisputeBounty rejects non-disputed bounties", async () => {
    const { resolveDisputeBounty } = await loadStore();
    const open = await createOpen();
    await expect(
      resolveDisputeBounty(open.id, MAINTAINER, true),
    ).rejects.toThrow(/only disputed/i);
  });

  it("resolveDisputeBounty enforces a configured arbiter address", async () => {
    const { disputeBounty, resolveDisputeBounty } = await loadStore();
    const id = await seedSubmitted();
    await disputeBounty(id, CONTRIBUTOR, "reason");
    process.env.ARBITER_ADDRESS = OTHER_ACCOUNT;
    await expect(
      resolveDisputeBounty(id, MAINTAINER, true),
    ).rejects.toThrow(/configured arbiter/i);
    const ok = await resolveDisputeBounty(id, OTHER_ACCOUNT, true);
    expect(ok.status).toBe("released");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extendDeadline", () => {
  it("rejects a deadline that is not strictly later than the current one", async () => {
    const { extendDeadline } = await loadStore();
    const created = await createOpen();
    await expect(
      extendDeadline(created.id, MAINTAINER, created.deadlineAt),
    ).rejects.toThrow(/later than the current deadline/i);
  });

  it("rejects a past deadline before the current-deadline check", async () => {
    const { extendDeadline } = await loadStore();
    const created = await createOpen();
    await expect(extendDeadline(created.id, MAINTAINER, 5)).rejects.toThrow(/future/i);
  });

  it("advances the deadline and logs previous/new values", async () => {
    const { extendDeadline } = await loadStore();
    const created = await createOpen();
    const next = created.deadlineAt + 10_000;
    const updated = await extendDeadline(created.id, MAINTAINER, next);
    expect(updated.deadlineAt).toBe(next);
    const event = updated.events.find((e) => e.type === "deadline_extended");
    expect(event?.details?.previousDeadline).toBe(created.deadlineAt);
    expect(event?.details?.newDeadline).toBe(next);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("audit log queries", () => {
  it("listBountyAuditLogs paginates and reports hasMore/nextOffset", async () => {
    const { reserveBounty, submitBounty, releaseBounty, listBountyAuditLogs } =
      await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, PR_URL);
    await releaseBounty(created.id, MAINTAINER);
    // reserve, submit, release -> 3 audit entries for this bounty
    const page1 = listBountyAuditLogs(created.id, { limit: 2, offset: 0 });
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.nextOffset).toBe(2);

    const page2 = listBountyAuditLogs(created.id, { limit: 2, offset: 2 });
    expect(page2.data).toHaveLength(1);
    expect(page2.pagination.hasMore).toBe(false);
    expect(page2.pagination.nextOffset).toBeNull();
  });

  it("listAllAuditLogs filters by actor, transition, and status", async () => {
    const { reserveBounty, submitBounty, releaseBounty, refundBounty, listAllAuditLogs } =
      await loadStore();
    const a = await createOpen({ issueNumber: 1 });
    await reserveBounty(a.id, CONTRIBUTOR);
    await submitBounty(a.id, CONTRIBUTOR, PR_URL);
    await releaseBounty(a.id, MAINTAINER);
    const b = await createOpen({ issueNumber: 2 });
    await refundBounty(b.id, MAINTAINER);

    expect(
      listAllAuditLogs({ transition: "reserve" }).data.every(
        (l) => l.transition === "reserve",
      ),
    ).toBe(true);
    expect(listAllAuditLogs({ transition: "reserve" }).data).toHaveLength(1);
    expect(
      listAllAuditLogs({ actor: CONTRIBUTOR }).data.every(
        (l) => l.actor === CONTRIBUTOR,
      ),
    ).toBe(true);
    expect(
      listAllAuditLogs({ toStatus: "refunded" }).data.every(
        (l) => l.toStatus === "refunded",
      ),
    ).toBe(true);
    expect(
      listAllAuditLogs({ bountyId: a.id }).data.every((l) => l.bountyId === a.id),
    ).toBe(true);
    expect(
      listAllAuditLogs({ fromStatus: "submitted" }).data.every(
        (l) => l.fromStatus === "submitted",
      ),
    ).toBe(true);
  });

  it("listAllAuditLogs paginates across all bounties", async () => {
    const { reserveBounty, listAllAuditLogs } = await loadStore();
    const a = await createOpen({ issueNumber: 1 });
    await reserveBounty(a.id, CONTRIBUTOR);
    const b = await createOpen({ issueNumber: 2 });
    await reserveBounty(b.id, CONTRIBUTOR);
    const page = listAllAuditLogs({ limit: 1, offset: 0 });
    expect(page.data).toHaveLength(1);
    expect(page.pagination.total).toBe(2);
    expect(page.pagination.hasMore).toBe(true);
    expect(page.pagination.nextOffset).toBe(1);
  });

  it("assigns zero-padded, sequential audit ids", async () => {
    const { reserveBounty, submitBounty, releaseBounty, listAllAuditLogs } =
      await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, PR_URL);
    await releaseBounty(created.id, MAINTAINER);
    const ids = listAllAuditLogs({ limit: 50 }).data.map((l) => l.id);
    expect(ids).toEqual(["AUD-000001", "AUD-000002", "AUD-000003"]);
  });

  it("omits undefined metadata keys from audit records", async () => {
    const { reserveBounty, submitBounty, disputeBounty, resolveDisputeBounty, listAllAuditLogs } =
      await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, PR_URL);
    await disputeBounty(created.id, CONTRIBUTOR, "reason");
    // resolve without a transaction hash -> transactionHash metadata is undefined
    await resolveDisputeBounty(created.id, MAINTAINER, true);
    const resolve = listAllAuditLogs({ transition: "resolve_dispute" }).data[0];
    expect(resolve.metadata).toBeDefined();
    expect(resolve.metadata).toHaveProperty("release", true);
    expect(resolve.metadata).not.toHaveProperty("transactionHash");
  });

  it("getBountyEvents returns the full event history", async () => {
    const { reserveBounty, getBountyEvents } = await loadStore();
    const created = await createOpen();
    await reserveBounty(created.id, CONTRIBUTOR);
    const events = getBountyEvents(created.id);
    expect(events.map((e) => e.type)).toEqual(["created", "reserved"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("metrics & leaderboard", () => {
  beforeEach(() => {
    // MAINTAINER holds exactly one bounty in every status (distinct amounts so a
    // mis-targeted status filter changes a count) plus OTHER_ACCOUNT holdings.
    writeRecords([
      makeRecord({ id: "BNT-0001", maintainer: MAINTAINER, status: "open", amount: 1 }),
      makeRecord({ id: "BNT-0002", maintainer: MAINTAINER, status: "reserved", contributor: CONTRIBUTOR, amount: 2 }),
      makeRecord({ id: "BNT-0003", maintainer: MAINTAINER, status: "submitted", contributor: CONTRIBUTOR, amount: 4 }),
      makeRecord({
        id: "BNT-0004",
        maintainer: MAINTAINER,
        status: "released",
        contributor: CONTRIBUTOR,
        amount: 8,
        protocolFeeCollected: 8,
      }),
      makeRecord({ id: "BNT-0005", maintainer: MAINTAINER, status: "refunded", amount: 16 }),
      makeRecord({ id: "BNT-0006", maintainer: MAINTAINER, status: "expired", amount: 32 }),
      makeRecord({
        id: "BNT-0007",
        maintainer: OTHER_ACCOUNT,
        status: "released",
        contributor: THIRD_ACCOUNT,
        amount: 40,
        protocolFeeCollected: 2,
      }),
    ]);
  });

  it("getMaintainerMetrics computes per-status counts, sums and average", async () => {
    const { getMaintainerMetrics } = await loadStore();
    const m = getMaintainerMetrics(MAINTAINER);
    expect(m.totalBounties).toBe(6);
    expect(m.openCount).toBe(1);
    expect(m.reservedCount).toBe(1);
    expect(m.submittedCount).toBe(1);
    expect(m.releasedCount).toBe(1);
    expect(m.refundedCount).toBe(1);
    expect(m.expiredCount).toBe(1);
    expect(m.totalFunded).toBe(63);
    expect(m.totalReleased).toBe(8);
    expect(m.averageRewardAmount).toBeCloseTo(63 / 6);
  });

  it("getMaintainerMetrics returns zero average for an unknown maintainer", async () => {
    const { getMaintainerMetrics } = await loadStore();
    const m = getMaintainerMetrics("GUNKNOWNADDRESS");
    expect(m.totalBounties).toBe(0);
    expect(m.averageRewardAmount).toBe(0);
  });

  it("getGlobalMetrics aggregates across maintainers and contributors", async () => {
    const { getGlobalMetrics } = await loadStore();
    const g = getGlobalMetrics();
    expect(g.totalBounties).toBe(7);
    expect(g.openCount).toBe(1);
    expect(g.reservedCount).toBe(1);
    expect(g.submittedCount).toBe(1);
    expect(g.releasedCount).toBe(2);
    expect(g.refundedCount).toBe(1);
    expect(g.expiredCount).toBe(1);
    expect(g.totalFunded).toBe(103);
    expect(g.totalReleased).toBe(48);
    expect(g.uniqueMaintainers).toBe(2);
    expect(g.uniqueContributors).toBe(2);
    expect(g.protocolFeesCollected).toBe(10);
  });

  it("getLeaderboard ranks released contributors by earnings", async () => {
    const { getLeaderboard } = await loadStore();
    const board = getLeaderboard();
    // THIRD_ACCOUNT earned 40, CONTRIBUTOR earned 8 -> THIRD ranks first.
    expect(board.map((e) => e.address)).toEqual([THIRD_ACCOUNT, CONTRIBUTOR]);
    expect(board[0].totalXlm).toBe(40);
    expect(board[0].bountiesCompleted).toBe(1);
  });

  it("getLeaderboard honours the limit argument", async () => {
    const { getLeaderboard } = await loadStore();
    expect(getLeaderboard(1)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("cache-backed reads", () => {
  it("listBountiesCached computes on miss, caches, and reuses on hit", async () => {
    const { listBountiesCached } = await loadStore();
    writeRecords([makeRecord({ id: "BNT-0001", status: "open" })]);
    const cache = makeFakeCache();

    const first = await listBountiesCached({}, cache);
    expect(first).toHaveLength(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.store.has("bounties:list")).toBe(true);

    // On hit the store is not recomputed: mutate the file, expect the cached copy.
    writeRecords([]);
    const second = await listBountiesCached({}, cache);
    expect(second).toHaveLength(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it("listBountiesCached applies filters to the cached list", async () => {
    const { listBountiesCached } = await loadStore();
    const cache = makeFakeCache();
    cache.store.set(
      "bounties:list",
      JSON.stringify([
        makeRecord({ id: "BNT-0001", status: "open", tokenSymbol: "XLM" }),
        makeRecord({ id: "BNT-0002", status: "released", tokenSymbol: "USDC" }),
      ]),
    );
    const result = await listBountiesCached({ status: "open" as BountyStatus }, cache);
    expect(result.map((b) => b.id)).toEqual(["BNT-0001"]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("listBountiesCached applies every filter and sort against the cached list", async () => {
    const { listBountiesCached } = await loadStore();
    const cache = makeFakeCache();
    cache.store.set(
      "bounties:list",
      JSON.stringify([
        makeRecord({
          id: "BNT-0001",
          title: "Alpha widget",
          summary: "first summary",
          labels: ["frontend"],
          contributor: CONTRIBUTOR,
          maintainer: MAINTAINER,
          tokenSymbol: "XLM",
          status: "open",
          amount: 10,
          deadlineAt: 5_000,
        }),
        makeRecord({
          id: "BNT-0002",
          title: "Beta task",
          summary: "Zeta keyword here",
          labels: ["urgent"],
          contributor: THIRD_ACCOUNT,
          maintainer: OTHER_ACCOUNT,
          tokenSymbol: "USDC",
          status: "released",
          amount: 20,
          deadlineAt: 8_000_000_000,
        }),
      ]),
    );

    const ids = async (opts: Record<string, unknown>) =>
      (await listBountiesCached(opts as never, cache)).map((b) => b.id);

    expect(await ids({ q: "alpha" })).toEqual(["BNT-0001"]);
    expect(await ids({ q: "zeta" })).toEqual(["BNT-0002"]);
    expect(await ids({ q: "URGENT" })).toEqual(["BNT-0002"]);
    expect(await ids({ contributor: CONTRIBUTOR })).toEqual(["BNT-0001"]);
    expect(await ids({ maintainer: OTHER_ACCOUNT })).toEqual(["BNT-0002"]);
    expect(await ids({ tokenSymbol: "usdc" })).toEqual(["BNT-0002"]);
    expect(await ids({ status: "open" })).toEqual(["BNT-0001"]);
    expect(await ids({ deadlineBefore: 6_000 })).toEqual(["BNT-0001"]);
    expect(await ids({ deadlineAfter: 6_000 })).toEqual(["BNT-0002"]);
    expect(await ids({ sort: "amount", order: "asc" })).toEqual(["BNT-0001", "BNT-0002"]);
    expect(await ids({ sort: "amount", order: "desc" })).toEqual(["BNT-0002", "BNT-0001"]);
    // reads came from the cache: never recomputed/stored
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("invalidateBountyCache deletes the list cache key", async () => {
    const { invalidateBountyCache } = await loadStore();
    const cache = makeFakeCache();
    cache.store.set("bounties:list", "[]");
    await invalidateBountyCache(cache);
    expect(cache.del).toHaveBeenCalledWith("bounties:list");
    expect(cache.store.has("bounties:list")).toBe(false);
  });

  it("getGlobalMetricsCached computes on miss and returns cached value on hit", async () => {
    const { getGlobalMetricsCached, aggregatedMetrics } = await loadStore();
    writeRecords([makeRecord({ id: "BNT-0001", amount: 100, status: "open" })]);
    const cache = makeFakeCache();

    const first = await getGlobalMetricsCached(cache);
    expect(first.totalBounties).toBe(1);
    expect(cache.set).toHaveBeenCalledTimes(1);

    writeRecords([]);
    const second = await getGlobalMetricsCached(cache);
    expect(second.totalBounties).toBe(1);
    expect(cache.set).toHaveBeenCalledTimes(1);

    // aggregatedMetrics wires the same functions.
    expect(aggregatedMetrics.getSync).toBeTypeOf("function");
    expect(aggregatedMetrics.getCached).toBe(getGlobalMetricsCached);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("not-found and guard errors", () => {
  it("throws a not-found error for unknown ids", async () => {
    const { reserveBounty, releaseBounty, getBountyEvents } = await loadStore();
    await expect(reserveBounty("BNT-9999", CONTRIBUTOR)).rejects.toThrow(/not found/i);
    await expect(releaseBounty("BNT-9999", MAINTAINER)).rejects.toThrow(/not found/i);
    expect(() => getBountyEvents("BNT-9999")).toThrow(/not found/i);
  });
});

export { PR_URL };
