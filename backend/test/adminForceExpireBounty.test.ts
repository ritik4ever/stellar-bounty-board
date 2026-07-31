import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-force-expire-${randomUUID()}.json`);
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

describe("adminForceExpireBounty", () => {
  it("releases a reserved bounty back to open, regardless of whether its timeout has elapsed", async () => {
    const { createBounty, reserveBounty, adminForceExpireBounty, listBountyAuditLogs } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 1,
      title: "Fix the widget spinner on slow networks",
      summary: "Ensure the loading state does not flash when latency is high for users.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 100,
      deadlineDays: 30,
      labels: [],
      reservationTimeoutSeconds: 604800,
    });

    await reserveBounty(created.id, CONTRIBUTOR);

    const { bounty, trigger } = await adminForceExpireBounty(created.id, "ops-jane");

    expect(trigger).toBe("reservation_timeout");
    expect(bounty.status).toBe("open");
    expect(bounty.contributor).toBeUndefined();
    expect(bounty.reservedAt).toBeUndefined();
    expect(bounty.version).toBe(created.version + 2);

    const lastEvent = bounty.events[bounty.events.length - 1];
    expect(lastEvent.type).toBe("expired");
    expect(lastEvent.actor).toBe("ops-jane");
    expect(lastEvent.details).toMatchObject({ reason: "admin_force_expire", trigger: "reservation_timeout" });

    const auditPage = listBountyAuditLogs(created.id);
    const auditEntry = auditPage.data.find((entry) => entry.transition === "expire");
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.actor).toBe("ops-jane");
    expect(auditEntry?.fromStatus).toBe("reserved");
    expect(auditEntry?.toStatus).toBe("open");
    expect(auditEntry?.metadata).toMatchObject({ reason: "admin_force_expire", trigger: "reservation_timeout" });
  });

  it("is an idempotent no-op for a bounty that is already expired (e.g. auto-expired for being stale)", async () => {
    const { createBounty, adminForceExpireBounty } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 2,
      title: "A bounty that will go stale for this test",
      summary: "Deliberately given a deadline in the past — listBounties auto-expires it on read.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 50,
      deadlineDays: -1,
      labels: [],
    });

    const { bounty, trigger, mutated } = await adminForceExpireBounty(created.id, "ops-jane");

    expect(trigger).toBe("already_expired");
    expect(mutated).toBe(false);
    expect(bounty.status).toBe("expired");
  });

  it("rejects an open bounty that has not yet reached its deadline", async () => {
    const { createBounty, adminForceExpireBounty } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 3,
      title: "A perfectly healthy, active bounty",
      summary: "Not stale and not reserved; should not be force-expirable.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 50,
      deadlineDays: 30,
      labels: [],
    });

    await expect(adminForceExpireBounty(created.id, "ops-jane")).rejects.toThrow(/not eligible/i);
  });

  it("rejects a submitted bounty", async () => {
    const { createBounty, reserveBounty, submitBounty, adminForceExpireBounty } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 4,
      title: "A bounty already submitted for review",
      summary: "Submitted bounties should not be force-expirable through this path.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 50,
      deadlineDays: 30,
      labels: [],
    });
    await reserveBounty(created.id, CONTRIBUTOR);
    await submitBounty(created.id, CONTRIBUTOR, "https://github.com/acme/widget/pull/1");

    await expect(adminForceExpireBounty(created.id, "ops-jane")).rejects.toThrow(/not eligible/i);
  });

  it("throws when the bounty id does not exist", async () => {
    const { adminForceExpireBounty } = await loadStore();

    await expect(adminForceExpireBounty("BNT-9999", "ops-jane")).rejects.toThrow(/not found/i);
  });
});
