import { describe, expect, it } from "vitest";

import { createDefaultProfile, generateRecommendations, scoreMatch } from "./recommendations";
import type { Bounty } from "./types";

function createBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "BNT-0001",
    repo: "owner/repo",
    issueNumber: 1,
    title: "Add wallet dashboard",
    summary: "Build a contributor flow",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    tokenSymbol: "XLM",
    amount: 25,
    labels: [],
    status: "open",
    createdAt: 1_700_000_000,
    deadlineAt: 1_700_086_400,
    version: 1,
    events: [],
    ...overrides,
  };
}

describe("recommendations", () => {
  it("returns no recommendations for an empty bounty list", () => {
    expect(generateRecommendations([], createDefaultProfile())).toEqual([]);
  });

  it("scores matches from bounty tags", () => {
    const bounty = createBounty({ tags: ["Rust", "Soroban"] });

    expect(scoreMatch(bounty, ["rust"])).toBe(1);
  });

  it("scores partial title and summary token matches", () => {
    const bounty = createBounty({
      title: "Build React-native wallet views",
      summary: "Add a Node.js API bridge",
    });

    expect(scoreMatch(bounty, ["react", "node", "python"])).toBeCloseTo(2 / 3);
  });

  it("returns zero when skills are unrelated", () => {
    const bounty = createBounty({
      title: "Improve payout audit export",
      summary: "Add CSV formatting for maintainer reports",
      tags: ["stellar"],
    });

    expect(scoreMatch(bounty, ["python"])).toBe(0);
  });
});
