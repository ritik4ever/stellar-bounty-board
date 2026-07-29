import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-race-${randomUUID()}.json`);
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
    fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
  } catch {
    /* best-effort */
  }
});

async function loadStore() {
  return import("../src/services/bountyStore");
}

describe("concurrent extend_deadline / dispute_bounty race (#912)", () => {
  it("resolves deterministically — one succeeds, the other is rejected — without corrupting bounty state", async () => {
    const {
      createBounty,
      reserveBounty,
      submitBounty,
      extendDeadline,
      disputeBounty,
      listBounties,
      listBountyAuditLogs,
    } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 42,
      title: "Race condition test bounty for extend/dispute",
      summary: "A bounty used to exercise the extend_deadline vs dispute_bounty race.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });
    await reserveBounty(created.id, CONTRIBUTOR);
    const submitted = await submitBounty(
      created.id,
      CONTRIBUTOR,
      "https://github.com/acme/widget/pull/42",
    );

    const newDeadline = submitted.deadlineAt + 7 * 24 * 60 * 60;

    // Capture any unhandled rejection during the race, so its absence is an
    // explicit assertion rather than something only vitest's own top-level
    // detection would (maybe) catch.
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    // Both calls start executing synchronously up to their first await (the
    // file lock acquisition) in the same tick, so they genuinely contend for
    // the same lock rather than merely running one after the other.
    const [extendResult, disputeResult] = await Promise.allSettled([
      extendDeadline(created.id, MAINTAINER, newDeadline),
      disputeBounty(created.id, CONTRIBUTOR, "Submission review is overdue."),
    ]);

    process.off("unhandledRejection", onUnhandledRejection);
    // Let any microtask-queued rejection surface before asserting on it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);

    const outcomes = [extendResult.status, disputeResult.status];
    // The store lock is acquired with retries: 0 (fail fast on contention), so
    // exactly one of the two concurrent calls must succeed and the other must
    // be rejected outright — never both succeeding, never both failing.
    expect(outcomes.filter((status) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((status) => status === "rejected")).toHaveLength(1);

    const record = listBounties().find((bounty) => bounty.id === created.id);
    expect(record).toBeDefined();
    const transitions = listBountyAuditLogs(created.id).data.map(
      (entry) => entry.transition,
    );

    if (extendResult.status === "fulfilled") {
      // extend_deadline won: deadline updated, status untouched, no dispute recorded.
      expect(record!.status).toBe("submitted");
      expect(record!.deadlineAt).toBe(newDeadline);
      expect(transitions).toContain("extend_deadline");
      expect(transitions).not.toContain("dispute");
      expect(disputeResult.status).toBe("rejected");
    } else {
      // dispute_bounty won: status moved to disputed, deadline untouched.
      expect(record!.status).toBe("disputed");
      expect(record!.deadlineAt).toBe(submitted.deadlineAt);
      expect(transitions).toContain("dispute");
      expect(transitions).not.toContain("extend_deadline");
      expect(extendResult.status).toBe("rejected");
    }

    // Whichever operation won accounts for the entire observable change —
    // no partial, duplicate, or interleaved writes from the loser.
    expect(record!.version).toBe(submitted.version + 1);
  });

  it("lets a second attempt succeed after the loser retries post-race", async () => {
    const {
      createBounty,
      reserveBounty,
      submitBounty,
      extendDeadline,
      disputeBounty,
      listBounties,
    } = await loadStore();

    const created = await createBounty({
      repo: "acme/widget",
      issueNumber: 43,
      title: "Race retry test bounty for extend/dispute",
      summary: "Confirms the loser of the race can succeed on a later retry.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 100,
      deadlineDays: 14,
      labels: [],
    });
    await reserveBounty(created.id, CONTRIBUTOR);
    const submitted = await submitBounty(
      created.id,
      CONTRIBUTOR,
      "https://github.com/acme/widget/pull/43",
    );
    const newDeadline = submitted.deadlineAt + 7 * 24 * 60 * 60;

    const [extendResult, disputeResult] = await Promise.allSettled([
      extendDeadline(created.id, MAINTAINER, newDeadline),
      disputeBounty(created.id, CONTRIBUTOR, "Submission review is overdue."),
    ]);

    // Whichever call lost the race only failed on lock contention, not a
    // business-rule violation — the lock is released once the race settles,
    // so a plain (non-concurrent) retry afterward should succeed cleanly.
    // extend_deadline has no status guard at all, so it succeeds regardless
    // of which operation won; dispute_bounty requires status "submitted",
    // which only extend_deadline (not itself) could have left unchanged.
    if (disputeResult.status === "rejected") {
      expect(extendResult.status).toBe("fulfilled");
      const retried = await disputeBounty(
        created.id,
        CONTRIBUTOR,
        "Retry after losing the race.",
      );
      expect(retried.status).toBe("disputed");
    } else {
      expect(extendResult.status).toBe("rejected");
      const current = listBounties().find((bounty) => bounty.id === created.id)!;
      const retried = await extendDeadline(
        created.id,
        MAINTAINER,
        current.deadlineAt + 1,
      );
      expect(retried.deadlineAt).toBe(current.deadlineAt + 1);
    }
  });
});
