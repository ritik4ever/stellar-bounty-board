
import { describe, expect, it } from "vitest";
import {
  calculateRecommendationScore,
  createDefaultProfile,
  generateRecommendations,
  scoreMatch,
  updateProfileFromBounties,
} from "./recommendations";
import { Bounty } from "./types";

const baseBounty: Bounty = {
  id: "BNTY-1",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 1,
  title: "React TypeScript dashboard",
  summary: "Build frontend bounty tooling",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contributor: undefined,
  tokenSymbol: "XLM",
  amount: 100,
  labels: [{ name: "frontend", color: "ededed" }],
  tags: ["React"],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

describe("scoreMatch", () => {
  it("scores matches across labels, tags, title, and summary", () => {
    expect(scoreMatch(baseBounty, ["React", "frontend", "Python"])).toBeCloseTo(2 / 3);
  });

  it("returns zero when there are no contributor skills", () => {
    expect(scoreMatch(baseBounty, [])).toBe(0);
  });
});

describe("recommendation helpers", () => {
  it("calculates recommendation scores and reasons from contributor history", () => {
    const profile = {
      completedLabels: ["frontend"],
      preferredRepos: ["ritik4ever"],
      averageRewardRange: { min: 50, max: 150 },
      skills: ["React", "TypeScript"],
    };

    const result = calculateRecommendationScore(baseBounty, profile);

    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons).toContain('You\'ve worked with "frontend" before');
    expect(result.reasons).toContain("You're familiar with ritik4ever/stellar-bounty-board");
  });

  it("generates sorted recommendations for open bounties only", () => {
    const recommendations = generateRecommendations(
      [
        baseBounty,
        { ...baseBounty, id: "BNTY-2", status: "reserved", labels: [{ name: "backend", color: "ededed" }] },
      ],
      {
        completedLabels: ["frontend"],
        preferredRepos: ["ritik4ever"],
        averageRewardRange: { min: 0, max: 200 },
        skills: ["React"],
      },
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].bounty.id).toBe("BNTY-1");
  });

  it("creates and updates contributor profiles from released bounties", () => {
    const profile = createDefaultProfile();
    const updated = updateProfileFromBounties(profile, [
      {
        ...baseBounty,
        status: "released",
        contributor: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY",
        labels: [
          { name: "frontend", color: "ededed" },
          { name: "testing", color: "ededed" },
        ],
      },
      { ...baseBounty, id: "BNTY-2", status: "refunded", labels: [{ name: "backend", color: "ededed" }] },
    ]);

    expect(updated.completedLabels).toEqual(["frontend", "testing"]);
    expect(updated.preferredRepos).toEqual(["ritik4ever"]);
    expect(updated.averageRewardRange).toEqual({ min: 100, max: 100 });
    expect(updated.skills).toEqual(expect.arrayContaining(["Frontend", "Testing"]));
  });
});
