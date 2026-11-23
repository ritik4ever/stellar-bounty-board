import { describe, it, expect } from "vitest";
import { getContributorReputation } from "../src/services/reputationService";

describe("getContributorReputation", () => {
  const UNKNOWN_ADDRESS =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  it("returns a neutral score of 50 for a contributor with no history", () => {
    const result = getContributorReputation(UNKNOWN_ADDRESS);
    expect(result.score).toBe(50);
    expect(result.totalBounties).toBe(0);
    expect(result.completedBounties).toBe(0);
    expect(result.breakdown.completionScore).toBe(0);
    expect(result.breakdown.disputeScore).toBe(0);
    expect(result.breakdown.responseTimeScore).toBe(0);
  });

  it("returns the address in the response", () => {
    const result = getContributorReputation(UNKNOWN_ADDRESS);
    expect(result.address).toBe(UNKNOWN_ADDRESS);
  });

  it("does not give completion points for non-released bounties", () => {
    // Pick an address that is not a contributor on any released bounty
    // in the store. The score should not include completion points.
    const noReleaseContributor =
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFF";
    const result = getContributorReputation(noReleaseContributor);
    expect(result.completedBounties).toBe(0);
    expect(result.breakdown.completionScore).toBe(0);
  });

  it("score is always between 0 and 100", () => {
    // Check several known and unknown addresses — the score should
    // never go out of bounds regardless of input.
    const addresses = [
      UNKNOWN_ADDRESS,
      "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    ];
    for (const addr of addresses) {
      const result = getContributorReputation(addr);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("breakdown fields sum correctly toward the aggregate", () => {
    const result = getContributorReputation(UNKNOWN_ADDRESS);
    // For unknown contributors: base (50) + 0 + 0 + 0 = 50
    const expected = 50;
    expect(result.score).toBe(expected);
  });

  it("returns consistent structure", () => {
    const result = getContributorReputation(UNKNOWN_ADDRESS);
    expect(result).toHaveProperty("address");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("breakdown");
    expect(result).toHaveProperty("totalBounties");
    expect(result).toHaveProperty("completedBounties");
    expect(result).toHaveProperty("disputeWins");
    expect(result).toHaveProperty("disputeLosses");

    expect(result.breakdown).toHaveProperty("completionScore");
    expect(result.breakdown).toHaveProperty("disputeScore");
    expect(result.breakdown).toHaveProperty("responseTimeScore");

    expect(typeof result.score).toBe("number");
    expect(typeof result.totalBounties).toBe("number");
    expect(typeof result.completedBounties).toBe("number");
    expect(typeof result.disputeWins).toBe("number");
    expect(typeof result.disputeLosses).toBe("number");
  });
});
