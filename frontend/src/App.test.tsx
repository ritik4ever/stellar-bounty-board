import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bounty } from "./types";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("./api", () => ({
  createBounty: vi.fn(),
  exportReleasedPayoutsCsv: vi.fn(),
  getBounty: vi.fn(),
  listBounties: vi.fn(),
  listOpenIssues: vi.fn(),
  refundBounty: vi.fn(),
  releaseBounty: vi.fn(),
  reserveBounty: vi.fn(),
  submitBounty: vi.fn(),
}));

import * as api from "./api";
import App from "./App";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const bounty: Bounty = {
  id: "BNTY-284",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 284,
  title: "Skeleton replacement bounty",
  summary: "Shows the real card after the initial fetch finishes.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 75,
  labels: [],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("App bounty list loading state", () => {
  it("shows six skeleton cards while the initial bounty fetch is pending", async () => {
    const bountiesRequest = deferred<Bounty[]>();
    vi.mocked(api.listBounties).mockReturnValueOnce(bountiesRequest.promise);

    render(<App />);

    const skeletonList = screen.getByTestId("bounty-skeleton-list");
    expect(skeletonList).toHaveAttribute("aria-busy", "true");
    expect(within(skeletonList).getAllByTestId("skeleton-bounty-card")).toHaveLength(6);

    bountiesRequest.resolve([bounty]);

    await waitFor(() => expect(screen.getByText("Skeleton replacement bounty")).toBeInTheDocument());
    expect(screen.queryByTestId("bounty-skeleton-list")).not.toBeInTheDocument();
  });

  it("shows a retry button when the initial bounty fetch fails", async () => {
    vi.mocked(api.listBounties)
      .mockRejectedValueOnce(new Error("Loading failed"))
      .mockResolvedValueOnce([bounty]);

    render(<App />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Loading failed"));

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.getByText("Skeleton replacement bounty")).toBeInTheDocument());
    expect(api.listBounties).toHaveBeenCalledTimes(2);
  });
});
