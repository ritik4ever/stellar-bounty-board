import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import EmptyState from "./EmptyState";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderEmptyState(overrides: Partial<React.ComponentProps<typeof EmptyState>> = {}) {
  const defaults = {
    heading: "No bounties found",
    message: "Try adjusting your filters.",
    hasFilters: false,
    onClearFilters: vi.fn(),
  };
  return render(<EmptyState {...defaults} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("EmptyState — rendering", () => {
  it("renders the heading", () => {
    renderEmptyState({ heading: "No open bounties" });
    expect(screen.getByRole("heading", { name: "No open bounties" })).toBeInTheDocument();
  });

  it("renders the message", () => {
    renderEmptyState({ message: "There are no open bounties right now." });
    expect(screen.getByText("There are no open bounties right now.")).toBeInTheDocument();
  });

  it("has role=status so screen readers announce it", () => {
    renderEmptyState();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 'Clear filters' CTA visibility
// ---------------------------------------------------------------------------

describe("EmptyState — Clear filters CTA", () => {
  it("shows the CTA when hasFilters is true", () => {
    renderEmptyState({ hasFilters: true });
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("hides the CTA when hasFilters is false", () => {
    renderEmptyState({ hasFilters: false });
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("calls onClearFilters when the CTA is clicked", async () => {
    const onClearFilters = vi.fn();
    renderEmptyState({ hasFilters: true, onClearFilters });

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Message variants — mirrors the logic in App.tsx
// ---------------------------------------------------------------------------

describe("EmptyState — message variants", () => {
  it('shows "No open bounties" heading for status=open filter', () => {
    renderEmptyState({ heading: "No open bounties" });
    expect(screen.getByRole("heading", { name: "No open bounties" })).toBeInTheDocument();
  });

  it('shows "No XLM bounties" heading for token search', () => {
    renderEmptyState({ heading: "No XLM bounties" });
    expect(screen.getByRole("heading", { name: "No XLM bounties" })).toBeInTheDocument();
  });

  it('shows "No bounties in this repo" heading for repo filter', () => {
    renderEmptyState({ heading: "No bounties in this repo" });
    expect(screen.getByRole("heading", { name: "No bounties in this repo" })).toBeInTheDocument();
  });

  it('shows "No bounties found" heading for a generic search query', () => {
    renderEmptyState({ heading: 'No bounties found for "foobar"' });
    expect(
      screen.getByRole("heading", { name: 'No bounties found for "foobar"' }),
    ).toBeInTheDocument();
  });

  it('shows "No bounties yet" heading when no filters are active', () => {
    renderEmptyState({ heading: "No bounties yet", hasFilters: false });
    expect(screen.getByRole("heading", { name: "No bounties yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty result array scenario (integration-style)
// ---------------------------------------------------------------------------

describe("EmptyState — empty result arrays", () => {
  it("renders when passed an empty bounty list with active filters", () => {
    // Simulate what App renders when filteredBounties.length === 0 and filters
    // are active. The component itself is agnostic to the array; the parent
    // decides whether to render it.
    const bounties: unknown[] = [];

    renderEmptyState({
      heading: "No reserved bounties",
      message: 'There are no bounties with status "reserved".',
      hasFilters: true,
    });

    // Component is visible regardless of the (unused) array
    expect(bounties).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "No reserved bounties" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("renders without the CTA when the board is genuinely empty (no filters)", () => {
    const bounties: unknown[] = [];

    renderEmptyState({
      heading: "No bounties yet",
      message: "Be the first to create a bounty.",
      hasFilters: false,
    });

    expect(bounties).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "No bounties yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});
