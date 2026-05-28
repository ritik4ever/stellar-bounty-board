import { describe, expect, it } from "vitest";
import { createDefaultProfile, generateRecommendations } from "./recommendations";

describe("recommendations", () => {
  it("returns no recommendations for an empty bounty list", () => {
    expect(generateRecommendations([], createDefaultProfile())).toEqual([]);
  });
});
