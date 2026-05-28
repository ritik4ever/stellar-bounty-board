import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import EmptyState from "./EmptyState";
import type { EmptyStateProps } from "./EmptyState";

function renderEmptyState(props: Partial<EmptyStateProps> = {}) {
  return render(<EmptyState {...props} />);
}

describe("EmptyState", () => {
  it("renders the default message when no filters are active", () => {
    renderEmptyState();
    expect(screen.getByText("No bounties found")).toBeInTheDocument();
    expect(screen.getByText("No bounties available yet")).toBeInTheDocument();
  });

  it("shows a search-specific message when searchQuery is provided", () => {
    renderEmptyState({ searchQuery: "react hooks" });
    expect(screen.getByText(/No bounties match/i)).toBeInTheDocument();
    expect(screen.getByText("react hooks")).toBeInTheDocument();
  });

  it("shows a status-specific message for a non-'all' status filter", () => {
    renderEmptyState({ statusFilter: "open" });
    expect(screen.getByText("No open bounties")).toBeInTheDocument();
  });

  it("omits the status message when statusFilter is 'all'", () => {
    renderEmptyState({ statusFilter: "all" });
    // 'all' is treated as no filter — should show the default
    expect(screen.getByText("No bounties available yet")).toBeInTheDocument();
  });

  it("shows a repo-specific message when repoFilter is provided", () => {
    renderEmptyState({ repoFilter: "ritik4ever/stellar-bounty-board" });
    expect(
      screen.getByText("No bounties in ritik4ever/stellar-bounty-board"),
    ).toBeInTheDocument();
  });

  it("shows a reward-range message when minReward or maxReward is set", () => {
    renderEmptyState({ minReward: "10", maxReward: "100" });
    expect(
      screen.getByText("No XLM bounties in this reward range"),
    ).toBeInTheDocument();
  });

  it("renders the Clear filters button when filters are active and a callback is provided", async () => {
    const onClear = vi.fn();
    renderEmptyState({ searchQuery: "something", onClearFilters: onClear });

    const button = screen.getByRole("button", { name: /clear filters/i });
    expect(button).toBeInTheDocument();

    await userEvent.click(button);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("does not render the Clear filters button when no filters are active", () => {
    renderEmptyState({ onClearFilters: vi.fn() });
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();
  });

  it("renders for empty result arrays (no filters) gracefully", () => {
    const { container } = renderEmptyState();
    expect(container.querySelector(".empty-state")).toBeInTheDocument();
    expect(
      screen.getByText("Create the first bounty to get started"),
    ).toBeInTheDocument();
  });
});
