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
      listBounties,
    } = await loadStore();

    const created = createBounty({
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

    const reserved = reserveBounty(created.id, CONTRIBUTOR);
    expect(reserved.status).toBe("reserved");
    expect(reserved.contributor).toBe(CONTRIBUTOR);
    expect(reserved.reservedAt).toBeDefined();

    const submitted = submitBounty(
      created.id,
      CONTRIBUTOR,
      "https://github.com/acme/widget/pull/42",
      "Ready for review",
    );
    expect(submitted.status).toBe("submitted");
    expect(submitted.submissionUrl).toContain("pull");
    expect(submitted.submittedAt).toBeDefined();

    const released = releaseBounty(created.id, MAINTAINER);
    expect(released.status).toBe("released");
    expect(released.releasedAt).toBeDefined();

    const listed = listBounties();
    expect(listed.find((b) => b.id === created.id)?.status).toBe("released");
  });

  it("create → refund from open", async () => {
    const { createBounty, refundBounty } = await loadStore();
    const created = createBounty({
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

    const refunded = refundBounty(created.id, MAINTAINER);
    expect(refunded.status).toBe("refunded");
    expect(refunded.refundedAt).toBeDefined();
  });

  it("create → reserve → refund", async () => {
    const { createBounty, reserveBounty, refundBounty } = await loadStore();
    const created = createBounty({
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
    reserveBounty(created.id, CONTRIBUTOR);
    const refunded = refundBounty(created.id, MAINTAINER);
    expect(refunded.status).toBe("refunded");
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
    };
    fs.writeFileSync(storeFile, JSON.stringify([record]), "utf8");

    const { listBounties } = await loadStore();
    const listed = listBounties();
    expect(listed[0].status).toBe("expired");

    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as BountyRecord[];
    expect(raw[0].status).toBe("expired");
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
    };
    fs.writeFileSync(storeFile, JSON.stringify([record]), "utf8");

    const { listBounties, reserveBounty } = await loadStore();
    expect(listBounties()[0].status).toBe("expired");
    expect(() => reserveBounty("BNT-0001", CONTRIBUTOR)).toThrow(/only open/i);
  });
});

describe("bountyStore — invalid transitions and errors", () => {
  it("throws when bounty id is missing", async () => {
    const { reserveBounty } = await loadStore();
    expect(() => reserveBounty("BNT-9999", CONTRIBUTOR)).toThrow(/not found/i);
  });

  it("reserve: rejects non-open statuses", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty, refundBounty } =
      await loadStore();

    const b = createBounty({
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

    reserveBounty(b.id, CONTRIBUTOR);
    expect(() => reserveBounty(b.id, CONTRIBUTOR)).toThrow(/only open/i);

    submitBounty(b.id, CONTRIBUTOR, "https://example.com/pr/1");
    expect(() => reserveBounty(b.id, CONTRIBUTOR)).toThrow(/only open/i);

    releaseBounty(b.id, MAINTAINER);
    expect(() => reserveBounty(b.id, CONTRIBUTOR)).toThrow(/only open/i);

    const b2 = createBounty({
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
    refundBounty(b2.id, MAINTAINER);
    expect(() => reserveBounty(b2.id, CONTRIBUTOR)).toThrow(/only open/i);
  });

  it("submit: requires reserved and matching contributor", async () => {
    const { createBounty, reserveBounty, submitBounty } = await loadStore();
    const b = createBounty({
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

    expect(() =>
      submitBounty(b.id, CONTRIBUTOR, "https://example.com/pr/1"),
    ).toThrow(/only reserved/i);

    reserveBounty(b.id, CONTRIBUTOR);
    expect(() =>
      submitBounty(b.id, OTHER_ACCOUNT, "https://example.com/pr/1"),
    ).toThrow(/reserved contributor/i);
  });

  it("release: requires maintainer and submitted status", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty } = await loadStore();
    const b = createBounty({
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

    expect(() => releaseBounty(b.id, MAINTAINER)).toThrow(/only submitted/i);

    reserveBounty(b.id, CONTRIBUTOR);
    expect(() => releaseBounty(b.id, MAINTAINER)).toThrow(/only submitted/i);

    submitBounty(b.id, CONTRIBUTOR, "https://example.com/pr/1");
    expect(() => releaseBounty(b.id, OTHER_ACCOUNT)).toThrow(/maintainer address/i);

    const released = releaseBounty(b.id, MAINTAINER);
    expect(released.status).toBe("released");
  });

  it("refund: rejects wrong maintainer, submitted, and finalized", async () => {
    const { createBounty, reserveBounty, submitBounty, releaseBounty, refundBounty } =
      await loadStore();

    const openB = createBounty({
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
    expect(() => refundBounty(openB.id, OTHER_ACCOUNT)).toThrow(/maintainer address/i);

    const flow = createBounty({
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
    reserveBounty(flow.id, CONTRIBUTOR);
    submitBounty(flow.id, CONTRIBUTOR, "https://example.com/pr/1");
    expect(() => refundBounty(flow.id, MAINTAINER)).toThrow(/submitted bounties/i);

    const rel = createBounty({
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
    reserveBounty(rel.id, CONTRIBUTOR);
    submitBounty(rel.id, CONTRIBUTOR, "https://example.com/pr/1");
    releaseBounty(rel.id, MAINTAINER);
    expect(() => refundBounty(rel.id, MAINTAINER)).toThrow(/finalized/i);

    const ref = createBounty({
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
    refundBounty(ref.id, MAINTAINER);
    expect(() => refundBounty(ref.id, MAINTAINER)).toThrow(/finalized/i);
  });
});
