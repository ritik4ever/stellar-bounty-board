import { describe, it, expect } from "vitest";
import { getLeaderboard } from "../src/services/bountyStore";

describe("getLeaderboard", () => {
  it("returns an array", () => {
    const result = getLeaderboard();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns at most the requested limit", () => {
    const result = getLeaderboard(3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("each entry has the required fields", () => {
    const result = getLeaderboard();
    for (const entry of result) {
      expect(entry).toHaveProperty("address");
      expect(entry).toHaveProperty("totalXlm");
      expect(entry).toHaveProperty("bountiesCompleted");
    }
  });

  it("is sorted by totalXlm descending", () => {
    const result = getLeaderboard();
    for (let i = 1; i < result.length; i++) {
      expect(result[i].totalXlm).toBeLessThanOrEqual(result[i - 1].totalXlm);
    }
  });
});
