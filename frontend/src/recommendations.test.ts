import { describe, expect, it } from "vitest";

import { scoreMatch } from "./recommendations";
import type { Bounty } from "./types";

const bounty: Bounty = {
  id: "BNTY-1",
  repo: "owner/repo",
  issueNumber: 1,
  title: "Add React wallet signing",
  summary: "Wire Freighter auth into the TypeScript frontend.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 100,
  labels: [{ name: "frontend", color: "0ea5e9" }],
  status: "open",
  createdAt: 1,
  deadlineAt: 2,
  version: 1,
  events: [],
};

describe("scoreMatch", () => {
  it("scores matching skills from labels, title, and summary", () => {
    expect(scoreMatch(bounty, ["react", "typescript", "rust"])).toBeGreaterThan(0.6);
  });
});
