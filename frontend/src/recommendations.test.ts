import { describe, expect, it } from "vitest";

import { scoreMatch } from "./recommendations";
import type { Bounty } from "./types";

const bounty: Bounty = {
  id: "BNTY-SKILL",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 12,
  title: "React frontend improvements",
  summary: "Make the dashboard easier to scan.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 50,
  labels: [{ name: "frontend", color: "1d76db" }],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

describe("scoreMatch", () => {
  it("scores matching skills from bounty labels and text", () => {
    expect(scoreMatch(bounty, ["frontend", "react"])).toBe(1);
  });

  it("scores matching skills from bounty tags", () => {
    const taggedBounty: Bounty = {
      ...bounty,
      labels: [],
      title: "General improvements",
      summary: "No explicit skill words here.",
      tags: ["TypeScript"],
    };

    expect(scoreMatch(taggedBounty, ["typescript"])).toBe(1);
  });
});
