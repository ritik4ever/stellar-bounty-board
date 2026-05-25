
import { describe, expect, it } from "vitest";
import { scoreMatch } from "./recommendations";
import { Bounty } from "./types";

const baseBounty: Bounty = {
  id: "bounty-1",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 288,
  title: "Add live USD conversion",
  summary: "Fetch XLM/USD and display the converted value",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  tokenSymbol: "XLM",
  amount: 100,
  labels: [{ name: "frontend", color: "0e8a16" }],
  status: "open",
  createdAt: 1,
  deadlineAt: 2,
  version: 1,
  events: [],
};

describe("scoreMatch", () => {
  it("scores matching contributor skills against bounty labels", () => {
    expect(scoreMatch(baseBounty, ["frontend"])).toBe(1);
  });

  it("returns zero when there is no skill overlap", () => {
    expect(scoreMatch(baseBounty, ["rust"])).toBe(0);
  });
});
