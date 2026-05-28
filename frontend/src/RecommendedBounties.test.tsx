import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecommendedBounties from "./RecommendedBounties";
import type { BountyRecommendation } from "./recommendations";
import type { Bounty } from "./types";

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "BNTY-1",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 380,
    title: "Add coverage threshold",
    summary: "Keep frontend coverage from dropping",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: undefined,
    tokenSymbol: "USDC",
    amount: 75,
    labels: [{ name: "frontend", color: "ededed" }],
    tags: ["React", "Testing"],
    status: "open",
    createdAt: 1_700_000_000,
    deadlineAt: 1_700_172_800,
    version: 1,
    events: [],
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<Bounty> = {}): BountyRecommendation {
  return {
    bounty: makeBounty(overrides),
    reasons: ["Matches your frontend skills"],
    score: 0.82,
  };
}

describe("RecommendedBounties", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2023-11-14T22:13:20Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders loading skeleton cards", () => {
    const { container } = render(<RecommendedBounties recommendations={[]} loading />);

    expect(screen.getByRole("heading", { name: "Recommended bounties" })).toBeInTheDocument();
    expect(container.querySelectorAll(".bounty-card--skeleton")).toHaveLength(3);
  });

  it("renders an empty state when there are no recommendations", () => {
    render(<RecommendedBounties recommendations={[]} />);

    expect(
      screen.getByText("No recommendations available yet. Complete some bounties to get personalized suggestions!"),
    ).toBeInTheDocument();
  });

  it("renders recommendation details and issue links", () => {
    render(<RecommendedBounties recommendations={[makeRecommendation()]} />);

    expect(screen.getByText("82% match")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add coverage threshold" })).toBeInTheDocument();
    expect(screen.getByText("75 USDC")).toBeInTheDocument();
    expect(screen.getByText("2 days left")).toBeInTheDocument();
    expect(screen.getByText("GAAAAA...AWHF")).toBeInTheDocument();
    expect(screen.getByText("Matches your frontend skills")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ritik4ever/stellar-bounty-board #380" })).toHaveAttribute(
      "href",
      "https://github.com/ritik4ever/stellar-bounty-board/issues/380",
    );
  });

  it("filters by skill tag and can reset to all recommendations", async () => {
    const user = userEvent.setup();
    render(<RecommendedBounties recommendations={[makeRecommendation()]} />);

    await user.click(screen.getByRole("button", { name: "Python" }));
    expect(screen.getByText(/No recommended bounties match the/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Python" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("heading", { name: "Add coverage threshold" })).toBeInTheDocument();
  });
});
