import { describe, expect, it } from "vitest";
import { scoreMatch } from "./recommendations";
import { Bounty } from "./types";

const bounty: Bounty = {
  id: "BNTY-291",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 291,
  title: "Add debounced React search",
  summary: "Filter bounty cards with TypeScript and frontend state.",
  maintainer: "maintainer",
  tokenSymbol: "XLM",
  amount: 100,
  labels: [{ name: "frontend", color: "0f766e" }],
  tags: ["React"],
  status: "open",
  createdAt: 1,
  deadlineAt: 2,
  version: 1,
  events: [],
};

describe("scoreMatch", () => {
  it("scores skills against labels, tags, title, and summary text", () => {
    expect(scoreMatch(bounty, ["React", "TypeScript", "frontend"])).toBe(1);
  });

  it("returns zero when no skills match the bounty", () => {
    expect(scoreMatch(bounty, ["Rust"])).toBe(0);
  });
});
