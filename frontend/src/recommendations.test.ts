import { describe, expect, it } from "vitest";
import {
  createDefaultProfile,
  generateRecommendations,
  scoreMatch,
  updateProfileFromBounties,
} from "./recommendations";
import type { Bounty } from "./types";

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "BNT-1",
    repo: "owner/repo",
    issueNumber: 1,
    title: "React frontend work",
    summary: "Build a frontend feature with TypeScript.",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    tokenSymbol: "XLM",
    amount: 100,
    labels: [{ name: "frontend", color: "0075ca" }],
    status: "open",
    createdAt: 1_700_000_000,
    deadlineAt: 1_900_000_000,
    version: 1,
    events: [],
    ...overrides,
  };
}

describe("recommendations", () => {
  it("scores contributor skills against bounty labels", () => {
    expect(scoreMatch(makeBounty(), ["frontend", "backend"])).toBe(0.5);
    expect(scoreMatch(makeBounty(), ["rust"])).toBe(0);
  });

  it("generates only meaningful open bounty recommendations", () => {
    const profile = {
      ...createDefaultProfile(),
      completedLabels: ["frontend"],
      skills: ["frontend"],
    };

    const recommendations = generateRecommendations([
      makeBounty({ id: "open-match", status: "open" }),
      makeBounty({ id: "released-match", status: "released" }),
    ], profile);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.bounty.id).toBe("open-match");
  });

  it("learns skills from released bounty labels", () => {
    const updated = updateProfileFromBounties(createDefaultProfile(), [
      makeBounty({ status: "released", labels: [{ name: "testing", color: "0075ca" }] }),
    ]);

    expect(updated.skills).toContain("Testing");
    expect(updated.completedLabels).toContain("testing");
  });
});
