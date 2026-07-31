import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
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

const CONTRIBUTOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const openBounty: Bounty = {
  id: "BNTY-300",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 300,
  title: "Keyboard navigation bounty",
  summary: "Make the bounty board fully keyboard navigable.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "USDC",
  amount: 150,
  labels: [{ name: "accessibility", color: "0e8a16" }],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

function mockBrowserApis() {
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
}

async function renderBoard(bounties: Bounty[] = [openBounty]) {
  vi.mocked(api.listBounties).mockResolvedValue(bounties);
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  vi.mocked(api.getBounty).mockResolvedValue(bounties[0]);

  const result = render(<App />);
  await waitFor(() => expect(screen.getByText("Keyboard navigation bounty")).toBeInTheDocument());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowserApis();
  window.history.pushState(null, "", "/");
  window.prompt = vi.fn();
  window.alert = vi.fn();
});

describe("bounty card keyboard navigation", () => {
  it("tabs from a bounty card through nested controls including its action button", async () => {
    const user = userEvent.setup();
    await renderBoard();

    const card = screen.getByLabelText(/keyboard navigation bounty/i);
    card.focus();

    expect(card).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: /stellar-bounty-board #300/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Reserve" })).toHaveFocus();
  });

  it("opens the detail view with Enter on a focused bounty card", async () => {
    const user = userEvent.setup();
    await renderBoard();

    screen.getByLabelText(/keyboard navigation bounty/i).focus();
    await user.keyboard("{Enter}");

    expect(window.location.pathname).toBe("/bounties/BNTY-300");
  });

  it("opens the detail view with Space on a focused bounty card", async () => {
    const user = userEvent.setup();
    await renderBoard();

    screen.getByLabelText(/keyboard navigation bounty/i).focus();
    await user.keyboard(" ");

    expect(window.location.pathname).toBe("/bounties/BNTY-300");
  });

  it("activates action buttons without opening the card detail view", async () => {
    const user = userEvent.setup();
    vi.mocked(window.prompt).mockReturnValue(CONTRIBUTOR);
    vi.mocked(api.reserveBounty).mockResolvedValue({ ...openBounty, status: "reserved", contributor: CONTRIBUTOR });
    await renderBoard();

    await user.click(screen.getByRole("button", { name: "Reserve" }));

    await waitFor(() => expect(api.reserveBounty).toHaveBeenCalledWith("BNTY-300", CONTRIBUTOR));
    expect(window.location.pathname).toBe("/");
  });

  it("has no axe violations on the rendered bounty board", async () => {
    const { container } = await renderBoard();

    expect(await axe(container)).toHaveNoViolations();
  });
});
