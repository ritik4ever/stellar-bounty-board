import { describe, expect, it } from "vitest";
import { getUrgencyLevel, getUrgencyClass, UrgencyLevel } from "./utils";
import type { Bounty } from "./types";

/** Create a minimal bounty stub for testing urgency levels. */
function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "test-1",
    repo: "owner/repo",
    issueNumber: 1,
    title: "Test Bounty",
    summary: "A test bounty",
    maintainer: "G" + "A".repeat(55),
    tokenSymbol: "XLM",
    amount: 10,
    labels: [],
    status: "open",
    createdAt: 1000,
    deadlineAt: 1000 + 30 * 24 * 60 * 60, // 30 days from epoch
    version: 1,
    events: [],
    ...overrides,
  };
}

describe("getUrgencyLevel", () => {
  const NOW = 1000 + 15 * 24 * 60 * 60; // 15 days after createdAt

  it("returns 'plenty' for open bounty with >7 days remaining", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 10 * 24 * 60 * 60, // 10 days left
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("plenty");
  });

  it("returns 'warning' for open bounty with 1–7 days remaining", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 3 * 24 * 60 * 60, // 3 days left
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("warning");
  });

  it("returns 'warning' for open bounty with exactly 7 days remaining", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 7 * 24 * 60 * 60,
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("warning");
  });

  it("returns 'urgent' for open bounty with <24 hours remaining", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 12 * 60 * 60, // 12 hours left
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("urgent");
  });

  it("returns 'warning' for open bounty with exactly 24 hours remaining", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 24 * 60 * 60,
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("warning");
  });

  it("returns 'warning' for reserved bounty with 1–7 days remaining", () => {
    const bounty = makeBounty({
      status: "reserved",
      deadlineAt: NOW + 5 * 24 * 60 * 60,
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("warning");
  });

  it("returns 'urgent' for reserved bounty with <24 hours remaining", () => {
    const bounty = makeBounty({
      status: "reserved",
      deadlineAt: NOW + 2 * 60 * 60, // 2 hours left
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("urgent");
  });

  it("returns 'warning' for reserved bounty with >7 days remaining", () => {
    const bounty = makeBounty({
      status: "reserved",
      deadlineAt: NOW + 10 * 24 * 60 * 60, // 10 days left
    });
    // "plenty" (green) is reserved for "open" bounties only;
    // "reserved" bounties always show at least "warning" to indicate active assignment.
    expect(getUrgencyLevel(bounty, NOW)).toBe("warning");
  });

  it("returns 'ended' for expired bounty", () => {
    const bounty = makeBounty({ status: "expired" });
    expect(getUrgencyLevel(bounty, NOW)).toBe("ended");
  });

  it("returns 'ended' for released bounty", () => {
    const bounty = makeBounty({ status: "released" });
    expect(getUrgencyLevel(bounty, NOW)).toBe("ended");
  });

  it("returns 'ended' for refunded bounty", () => {
    const bounty = makeBounty({ status: "refunded" });
    expect(getUrgencyLevel(bounty, NOW)).toBe("ended");
  });

  it("returns 'ended' for open bounty past deadline", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW - 3600, // 1 hour ago
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("ended");
  });

  it("returns 'plenty' for submitted bounty (not open/reserved)", () => {
    const bounty = makeBounty({
      status: "submitted",
      deadlineAt: NOW + 3600,
    });
    expect(getUrgencyLevel(bounty, NOW)).toBe("plenty");
  });

  it("returns 'disputed' for disputed status", () => {
    const bounty = makeBounty({
      status: "open" as BountyStatus,
      deadlineAt: NOW + 3600,
    });
    // Simulate disputed by casting
    (bounty as any).status = "disputed";
    expect(getUrgencyLevel(bounty, NOW)).toBe("disputed");
  });
});

describe("getUrgencyClass", () => {
  const NOW = 1000 + 15 * 24 * 60 * 60;

  it("returns urgency-plenty for plenty level", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 10 * 24 * 60 * 60,
    });
    expect(getUrgencyClass(bounty, NOW)).toBe("urgency-plenty");
  });

  it("returns urgency-warning for warning level", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 3 * 24 * 60 * 60,
    });
    expect(getUrgencyClass(bounty, NOW)).toBe("urgency-warning");
  });

  it("returns urgency-urgent for urgent level", () => {
    const bounty = makeBounty({
      status: "open",
      deadlineAt: NOW + 12 * 60 * 60,
    });
    expect(getUrgencyClass(bounty, NOW)).toBe("urgency-urgent");
  });

  it("returns urgency-ended for ended level", () => {
    const bounty = makeBounty({ status: "expired" });
    expect(getUrgencyClass(bounty, NOW)).toBe("urgency-ended");
  });
});

// Re-export for type checking
type BountyStatus = "open" | "reserved" | "submitted" | "released" | "refunded" | "expired";
