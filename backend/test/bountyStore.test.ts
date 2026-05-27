import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BountyRecord } from "../src/services/bountyStore";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-store-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* temp cleanup best-effort */
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, ".audit.json");
    fs.unlinkSync(auditStorePath);
  } catch {
    /* temp cleanup best-effort */
  }
});

async function loadStore() {
  return import("../src/services/bountyStore");
}

describe("bountyStore lifecycle — happy paths", () => {
  it("create → reserve → submit → release", async () => {
    const {
      createBounty,
      reserveBounty,
      submitBounty,
      releaseBounty,
      listBountyAuditLogs,
      listBounties,
    } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner on slow networks",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });

    expect(created.status).toBe("open");
    expect(created.id).toMatch(/^BNT-\d{4}$/);
    expect(created.tokenSymbol).toBe("USDC");

    const reserved = await reserveBounty(created.id, CONTRIBUTOR);
    expect(reserved.status).toBe("reserved");
    expect(reserved.contributor).toBe(CONTRIBUTOR);
    expect(reserved.reservedAt).toBeDefined();

    const submitted = await submitBounty(
      created.id,
      CONTRIBUTOR,
      "https://github.com/acme/widget/pull/42",
      "Ready for review",
    );
    expect(submitted.status).toBe("submitted");
    expect(submitted.submissionUrl).toContain("pull");
    expect(submitted.submittedAt).toBeDefined();

    const txHash = "c".repeat(64);
    const released = await releaseBounty(created.id, MAINTAINER, txHash);
    expect(released.status).toBe("released");
    expect(released.releasedAt).toBeDefined();
    expect(released.releasedTxHash).toBe(txHash);

    const listed = listBounties();
    expect(listed.find((b) => b.id === created.id)?.status).toBe("released");

    const logs = listBountyAuditLogs(created.id);
    expect(logs.data.map((entry) => entry.transition)).toEqual(["reserve", "submit", "release"]);
    expect(logs.data[0]).toMatchObject({
      bountyId: created.id,
      fromStatus: "open",
      toStatus: "reserved",
      actor: CONTRIBUTOR,
    });
    expect(logs.data[1]?.metadata?.submissionUrl).toBe("https://github.com/acme/widget/pull/42");
    expect(logs.pagination.total).toBe(3);
  });

  it("create → refund from open", async () => {
    const { createBounty, refundBounty } = await loadStore();
    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 2,
      title: "Another bounty title with enough length",
      summary: "Description with at least twenty characters total here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 50,
      deadlineDays: 7,
      labels: [],
    });

    const txHash = "d".repeat(64);
    const refunded = await refundBounty(created.id, MAINTAINER, txHash);
    expect(refunded.status).toBe("refunded");
    expect(refunded.refundedAt).toBeDefined();
    expect(refunded.refundedTxHash).toBe(txHash);
  });

  it("create → reserve → refund", async () => {
    const { createBounty, reserveBounty, refundBounty } = await loadStore();
    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 3,
      title: "Third bounty title with sufficient chars",
      summary: "Third bounty summary with enough characters in it ok.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 25,
      deadlineDays: 7,
      labels: [],
    });
    await reserveBounty(created.id, CONTRIBUTOR);
    const refunded = await refundBounty(created.id, MAINTAINER);
    expect(refunded.status).toBe("refunded");
  });

  it("audit log pagination returns stable slices", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty, listBountyAuditLogs } =
      await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 4,
      title: "Pagination test bounty title with enough chars",
      summary: "Summary with enough length to satisfy schema validation.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 50,
      deadlineDays: 7,
      labels: [],
    });

    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/44");
    await releaseBounty(created.id, MAINTAINER);

    const first = listBountyAuditLogs(created.id, { limit: 2, offset: 0 });
    expect(first.data).toHaveLength(2);
    expect(first.pagination.hasMore).toBe(true);
    expect(first.pagination.nextOffset).toBe(2);

    const second = listBountyAuditLogs(created.id, { limit: 2, offset: 2 });
    expect(second.data).toHaveLength(1);
    expect(second.data[0]?.transition).toBe("release");
    expect(second.pagination.hasMore).toBe(false);
    expect(second.pagination.nextOffset).toBeNull();
  });
});

describe("bountyStore — expiration via normalizeRecords", () => {
  it("marks open bounties past deadline as expired when listed", async () => {
    const record: BountyRecord = {
      id: "BNT-0001",
      repo: "acme/widget",
      issueNumber: 1,
      title: "Expired open bounty title length ok",
      summary: "Summary text with at least twenty characters.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 10,
      labels: [],
      status: "open",
      createdAt: 100,
      deadlineAt: 1,
      version: 1,
      events: [{ type: "created", timestamp: 100 }],
    };
    fs.writeFileSync(storeFile, JSON.stringify([record]), "utf8");

    const { listBounties, listBountyAuditLogs } = await loadStore();
    const listed = listBounties();
    expect(listed[0].status).toBe("expired");

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[];
    expect(raw[0].status).toBe("expired");

    const logs = listBountyAuditLogs("BNT-0001");
    expect(logs.data).toHaveLength(1);
    expect(logs.data[0]).toMatchObject({
      transition: "expire",
      fromStatus: "open",
      toStatus: "expired",
      actor: "system",
    });
  });

  it("marks reserved bounties past deadline as expired when listed", async () => {
    const record: BountyRecord = {
      id: "BNT-0001",
      repo: "acme/widget",
      issueNumber: 1,
      title: "Expired reserved bounty title goes here",
      summary: "Summary text with at least twenty characters.",
      maintainer: MAINTAINER,
      contributor: CONTRIBUTOR,
      tokenSymbol: "XLM",
      amount: 10,
      labels: [],
      status: "reserved",
      createdAt: 100,
      deadlineAt: 1,
      reservedAt: 50,
      version: 2,
      events: [
        { type: "created", timestamp: 100 },
        { type: "reserved", timestamp: 150, actor: CONTRIBUTOR },
      ],
    };
    fs.writeFileSync(storeFile, JSON.stringify([record]), "utf8");

    const { listBounties, reserveBounty } = await loadStore();
    expect(listBounties()[0].status).toBe("expired");
    await expect(async () => await reserveBounty("BNT-0001", CONTRIBUTOR)).rejects.toThrow(/only open/i);
  });
});

describe("bountyStore — invalid transitions and errors", () => {
  it("throws when bounty id is missing", async () => {
    const { reserveBounty } = await loadStore();
    await expect(async () => await reserveBounty("BNT-9999", CONTRIBUTOR)).rejects.toThrow(/not found/i);
  });

  it("reserve: rejects non-open statuses", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty, refundBounty } =
      await loadStore();

    const b = await createBounty({
      repo: "acme/widget",
      issueNumber: 10,
      title: "Reserve guard bounty title long enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });

    await reserveBounty(b.id, CONTRIBUTOR);
    await expect(async () => await reserveBounty(b.id, CONTRIBUTOR)).rejects.toThrow(/only open/i);

    await submitBounty(b.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1");
    await expect(async () => await reserveBounty(b.id, CONTRIBUTOR)).rejects.toThrow(/only open/i);

    await releaseBounty(b.id, MAINTAINER);
    await expect(async () => await reserveBounty(b.id, CONTRIBUTOR)).rejects.toThrow(/only open/i);

    const b2 = await createBounty({
      repo: "acme/widget",
      issueNumber: 11,
      title: "Second reserve guard bounty title here",
      summary: "Another summary with enough characters in it.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });
    await refundBounty(b2.id, MAINTAINER);
    await expect(async () => await reserveBounty(b2.id, CONTRIBUTOR)).rejects.toThrow(/only open/i);
  });

  it("submit: requires reserved and matching contributor", async () => {
    const { createBounty, reserveBounty, submitBounty } = await loadStore();
    const b = await createBounty({
      repo: "acme/widget",
      issueNumber: 20,
      title: "Submit guard bounty title long enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });

    await expect(async () => await submitBounty(b.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1")).rejects.toThrow(/only reserved/i);

    await reserveBounty(b.id, CONTRIBUTOR);
    await expect(async () => await submitBounty(b.id, OTHER_ACCOUNT, "https://github.com/acme/widget/pull/1")).rejects.toThrow(/reserved contributor/i);
  });

  it("release: requires maintainer and submitted status", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty } = await loadStore();
    const b = await createBounty({
      repo: "acme/widget",
      issueNumber: 30,
      title: "Release guard bounty title long enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });

    await expect(async () => await releaseBounty(b.id, MAINTAINER)).rejects.toThrow(/only submitted/i);

    await reserveBounty(b.id, CONTRIBUTOR);
    await expect(async () => await releaseBounty(b.id, MAINTAINER)).rejects.toThrow(/only submitted/i);

    await submitBounty(b.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1");
    await expect(async () => await releaseBounty(b.id, OTHER_ACCOUNT)).rejects.toThrow(/maintainer address/i);

    const released = await releaseBounty(b.id, MAINTAINER);
    expect(released.status).toBe("released");
  });

  it("refund: rejects wrong maintainer, submitted, and finalized", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty, refundBounty } =
      await loadStore();

    const openB = await createBounty({
      repo: "acme/widget",
      issueNumber: 40,
      title: "Refund open bounty title long enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });
    await expect(async () => await refundBounty(openB.id, OTHER_ACCOUNT)).rejects.toThrow(/maintainer address/i);

    const flow = await createBounty({
      repo: "acme/widget",
      issueNumber: 41,
      title: "Refund submitted bounty title enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });
    await reserveBounty(flow.id, CONTRIBUTOR);
    await submitBounty(flow.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1");
    await expect(async () => await refundBounty(flow.id, MAINTAINER)).rejects.toThrow(/submitted bounties/i);

    const rel = await createBounty({
      repo: "acme/widget",
      issueNumber: 42,
      title: "Refund released bounty title enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });
    await reserveBounty(rel.id, CONTRIBUTOR);
    await submitBounty(rel.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1");
    await releaseBounty(rel.id, MAINTAINER);
    await expect(async () => await refundBounty(rel.id, MAINTAINER)).rejects.toThrow(/finalized/i);

    const ref = await createBounty({
      repo: "acme/widget",
      issueNumber: 43,
      title: "Refund twice bounty title long enough",
      summary: "Summary with twenty or more characters here.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 30,
      labels: [],
    });
    await refundBounty(ref.id, MAINTAINER);
    await expect(async () => await refundBounty(ref.id, MAINTAINER)).rejects.toThrow(/finalized/i);
  });
});


describe("bountyStore — event history and metrics", () => {
  it("getBountyEvents returns event history", async () => {
    const { createBounty, reserveBounty, getBountyEvents } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner on slow networks",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });

    const reserved = await reserveBounty(created.id, CONTRIBUTOR);

    const events = getBountyEvents(created.id);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe("created");
    expect(events[1].type).toBe("reserved");
    expect(events[1].actor).toBe(CONTRIBUTOR);
  });

  it("getMaintainerMetrics returns accurate counts", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty, getMaintainerMetrics } = await loadStore();

    const b1 = await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });

    const b2 = await createBounty({
      repo: "acme/widget",
      issueNumber: 2,
      title: "Add dark mode",
      summary: "Implement dark mode support for the widget component.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 50,
      deadlineDays: 14,
      labels: [],
    });

    await reserveBounty(b1.id, CONTRIBUTOR);
    await submitBounty(b1.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1");
    await releaseBounty(b1.id, MAINTAINER, "a".repeat(64));

    const metrics = getMaintainerMetrics(MAINTAINER);
    expect(metrics.totalBounties).toBe(2);
    expect(metrics.openCount).toBe(1);
    expect(metrics.releasedCount).toBe(1);
    expect(metrics.totalFunded).toBe(150);
    expect(metrics.totalReleased).toBe(100);
    expect(metrics.averageRewardAmount).toBe(75);
  });

  it("getGlobalMetrics returns system-wide counts", async () => {
    const { createBounty, getGlobalMetrics } = await loadStore();

    await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });

    const metrics = getGlobalMetrics();
    expect(metrics.totalBounties).toBeGreaterThan(0);
    expect(metrics.uniqueMaintainers).toBeGreaterThan(0);
  });

  it("race condition prevention: version mismatch on reserve", async () => {
    const { createBounty, reserveBounty } = await loadStore();

    const bounty = await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });

    // First reservation succeeds
    const reserved1 = await reserveBounty(bounty.id, CONTRIBUTOR);
    expect(reserved1.version).toBe(2);

    // Second reservation attempt should fail because bounty is no longer open
    await expect(async () => await reserveBounty(bounty.id, OTHER_ACCOUNT, 1)).rejects.toThrow(/only open bounties/i);
  });

  it("reservation timeout: expired reservations return to open", async () => {
    const { createBounty, reserveBounty } = await loadStore();

    const bounty = await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "usdc",
      amount: 100,
      deadlineDays: 14,
      labels: [],
      reservationTimeoutSeconds: 604800, // 7 days
    });

    const reserved = await reserveBounty(bounty.id, CONTRIBUTOR);
    expect(reserved.status).toBe("reserved");
    expect(reserved.reservedAt).toBeDefined();
    expect(reserved.reservationTimeoutSeconds).toBe(604800);
    expect(reserved.events.some((e) => e.type === "reserved")).toBe(true);
  });
});
