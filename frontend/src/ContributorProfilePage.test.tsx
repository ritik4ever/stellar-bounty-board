import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ContributorProfilePage from "./ContributorProfilePage";
import type { Bounty } from "./types";

vi.mock("./api", () => ({
  listBounties: vi.fn(),
}));

import { listBounties } from "./api";

const mockBounties: Bounty[] = [
  {
    id: "1",
    repo: "owner/repo-a",
    issueNumber: 10,
    title: "A",
    summary: "a",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    tokenSymbol: "XLM",
    amount: 100,
    labels: [],
    status: "released",
    createdAt: 0,
    deadlineAt: 0,
    version: 1,
    events: [],
  },
  {
    id: "2",
    repo: "owner/repo-b",
    issueNumber: 11,
    title: "B",
    summary: "b",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    tokenSymbol: "XLM",
    amount: 50,
    labels: [],
    status: "reserved",
    createdAt: 0,
    deadlineAt: 0,
    version: 1,
    events: [],
  },
  {
    id: "3",
    repo: "owner/repo-c",
    issueNumber: 12,
    title: "C",
    summary: "c",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    tokenSymbol: "XLM",
    amount: 25,
    labels: [],
    status: "refunded",
    createdAt: 0,
    deadlineAt: 0,
    version: 1,
    events: [],
  },
];

const mockLeaderboard = [
  { address: "GCCCC...CCC", totalXlm: 150.5, bountiesCompleted: 3 },
];

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(listBounties).mockResolvedValue(mockBounties);
  const globalAny: any = global;
  globalAny.fetch = vi.fn((url: string) => {
    if (url.includes("/api/bounties")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: mockBounties }) });
    }
    if (url.includes("/api/leaderboard")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: mockLeaderboard }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ContributorProfilePage", () => {
  it("renders stats and completed bounties from API", async () => {
    render(<ContributorProfilePage address={"GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"} />);

    await waitFor(() => expect(screen.getByText(/Total earned/i)).toBeInTheDocument());

    expect(screen.getByText(/Total earned/i).closest('div')?.querySelector('strong')).toHaveTextContent('100 XLM');
    expect(screen.getAllByText(/Completed bounties/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getByText(/Active reservations/)).toBeInTheDocument();

    // Completed bounty link
    expect(screen.getByRole("link", { name: /owner\/repo-a#10/ })).toBeInTheDocument();

    // Leaderboard entry
    expect(screen.getByText(/GCCCC...CCC/)).toBeInTheDocument();

    expect(screen.getByText(/connect your wallet to see personalized bounty recommendations/i)).toBeInTheDocument();
  });
});
