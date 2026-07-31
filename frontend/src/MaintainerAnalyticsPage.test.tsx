import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MaintainerAnalyticsPage from "./MaintainerAnalyticsPage";
import type { Bounty, MaintainerMetrics } from "./types";

vi.mock("recharts", async () => {
  const original = await vi.importActual<any>("recharts");
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 500, height: 260 }}>{children}</div>
    ),
  };
});

const mockMetrics: MaintainerMetrics = {
  maintainer: "GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK",
  totalBounties: 6,
  openCount: 2,
  reservedCount: 1,
  submittedCount: 1,
  releasedCount: 1,
  refundedCount: 0,
  expiredCount: 1,
  totalFunded: 600,
  totalReleased: 100,
  averageRewardAmount: 100,
};

const mockBounties: Bounty[] = [
  {
    id: "BNT-0001",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 1,
    title: "Bounty 1",
    summary: "Summary 1",
    maintainer: "GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK",
    amount: 100,
    tokenSymbol: "XLM",
    status: "released",
    labels: [],
    createdAt: 1710000000,
    deadlineAt: 1910000000,
    releasedAt: 1710003600,
    version: 2,
    events: [],
  },
  {
    id: "BNT-0002",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 2,
    title: "Bounty 2",
    summary: "Summary 2",
    maintainer: "GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK",
    amount: 150,
    tokenSymbol: "XLM",
    status: "open",
    labels: [],
    createdAt: 1710100000,
    deadlineAt: 1910100000,
    version: 1,
    events: [],
  },
];

describe("MaintainerAnalyticsPage", () => {
  it("renders metrics summary cards with accurate data", () => {
    render(
      <MaintainerAnalyticsPage
        metrics={mockMetrics}
        maintainerAddress={mockMetrics.maintainer}
        bounties={mockBounties}
        onBack={() => undefined}
      />
    );

    // Verify Title
    expect(screen.getByText(/Dashboard for GB5IWB...JOOK/i)).toBeInTheDocument();

    // Verify Summary Cards
    expect(screen.getByText("Total Bounties")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();

    expect(screen.getAllByText("Total Funded")[0]).toBeInTheDocument();
    expect(screen.getByText("600 XLM")).toBeInTheDocument();

    expect(screen.getAllByText("Total Released")[0]).toBeInTheDocument();
    expect(screen.getByText("100 XLM")).toBeInTheDocument();

    expect(screen.getByText("Average Reward")).toBeInTheDocument();
    expect(screen.getByText("100.0 XLM")).toBeInTheDocument();
  });

  it("renders both custom SVG charts", () => {
    render(
      <MaintainerAnalyticsPage
        metrics={mockMetrics}
        maintainerAddress={mockMetrics.maintainer}
        bounties={mockBounties}
        onBack={() => undefined}
      />
    );

    expect(screen.getByRole("heading", { name: "Bounties by Status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cumulative Escrow Over Time" })).toBeInTheDocument();
  });

  it("invokes onBack callback when clicking back button", () => {
    const onBackMock = vi.fn();
    render(
      <MaintainerAnalyticsPage
        metrics={mockMetrics}
        maintainerAddress={mockMetrics.maintainer}
        bounties={mockBounties}
        onBack={onBackMock}
      />
    );

    const backButton = screen.getByRole("button", { name: /go back to dashboard/i });
    fireEvent.click(backButton);

    expect(onBackMock).toHaveBeenCalledOnce();
  });
});
