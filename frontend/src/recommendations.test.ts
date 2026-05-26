import { describe, expect, it } from "vitest";
import { scoreMatch } from "./recommendations";
import type { Bounty } from "./types";

const bounty: Bounty = {
  id: "BNTY-120",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 120,
  title: "Improve React bounty recommendations",
  summary: "Add TypeScript-aware matching.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 150,
  labels: [{ name: "frontend", color: "ededed" }],
  status: "open",
  createdAt: 1,
  deadlineAt: 2,
  version: 1,
  events: [],
};

describe("scoreMatch", () => {
  it("matches declared skills against title, summary, and labels", () => {
    expect(scoreMatch(bounty, ["React", "TypeScript", "Rust"])).toBeCloseTo(2 / 3);
  });
});
