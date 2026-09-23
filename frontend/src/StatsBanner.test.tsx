import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsBanner } from "./StatsBanner";
import type { GlobalMetrics } from "./types";

const mockMetrics: GlobalMetrics = {
  totalBounties: 42,
  openCount: 15,
  reservedCount: 5,
  submittedCount: 2,
  releasedCount: 18,
  refundedCount: 2,
  expiredCount: 0,
  totalFunded: 25000,
  totalReleased: 12000,
  uniqueMaintainers: 8,
  uniqueContributors: 14,
};

describe("StatsBanner Component", () => {
  it("renders statistics correctly when metrics are provided", () => {
    render(<StatsBanner metrics={mockMetrics} />);

    expect(screen.getByText("Total Bounties")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    expect(screen.getByText("XLM Locked / Funded")).toBeInTheDocument();
    expect(screen.getByText("25,000 XLM")).toBeInTheDocument();

    expect(screen.getByText("Open Bounties")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("renders fallback zeroes when metrics are null", () => {
    render(<StatsBanner metrics={null} />);

    expect(screen.getByText("Total Bounties")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("0 XLM")).toBeInTheDocument();
  });

  it("renders loading skeleton when loading is true and metrics are missing", () => {
    render(<StatsBanner metrics={null} loading={true} />);

    expect(screen.getByTestId("stats-banner-loading")).toBeInTheDocument();
  });
});
