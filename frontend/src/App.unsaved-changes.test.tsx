import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockBounty: Bounty = {
  id: "BNTY-300",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 300,
  title: "Some bounty",
  summary: "A test bounty.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "USDC",
  amount: 150,
  labels: [{ name: "frontend", color: "0e8a16" }],
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
  // Keep track of the original confirm so we can restore it
  vi.spyOn(window, "confirm").mockImplementation(() => true);
}

async function renderBoard() {
  vi.mocked(api.listBounties).mockResolvedValue([mockBounty]);
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  vi.mocked(api.getBounty).mockResolvedValue(mockBounty);

  const result = render(<App />);
  await waitFor(() => expect(screen.getByText("Some bounty")).toBeInTheDocument());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowserApis();
  window.history.pushState(null, "", "/");
  window.prompt = vi.fn();
  window.alert = vi.fn();
});

describe("unsaved-changes warning (#856)", () => {
  it("does not prompt when navigating away without touching the form", async () => {
    const user = userEvent.setup();
    await renderBoard();

    // Click a bounty card to navigate to detail page — should not prompt
    // since no form field was touched
    await user.click(screen.getByLabelText(/some bounty/i));

    // confirm should NOT have been called because no form was touched
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("prompts when navigating away after modifying a form field", async () => {
    const user = userEvent.setup();
    await renderBoard();

    // Modify the title field
    const titleInput = screen.getByPlaceholderText("Add WebSocket updates...");
    await user.type(titleInput, "My new bounty");

    // Click a bounty card to navigate to detail page
    await user.click(screen.getByLabelText(/some bounty/i));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("unsaved changes"),
    );
  });

  it("does not prompt after successful submission", async () => {
    const user = userEvent.setup();
    await renderBoard();

    vi.mocked(api.createBounty).mockResolvedValue(mockBounty);

    // Fill in the form
    const titleInput = screen.getByPlaceholderText("Add WebSocket updates...");
    await user.clear(titleInput);
    await user.type(titleInput, "My new bounty");

    // Submit the form
    const submitButton = screen.getByRole("button", { name: /create bounty/i });
    await user.click(submitButton);

    await waitFor(() => expect(api.createBounty).toHaveBeenCalled());

    // Navigate away via bounty card — should NOT prompt because dirty flag was cleared
    await user.click(screen.getByLabelText(/some bounty/i));

    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("does not prompt after explicit discard", async () => {
    const user = userEvent.setup();
    await renderBoard();

    // Modify the form
    const titleInput = screen.getByPlaceholderText("Add WebSocket updates...");
    await user.type(titleInput, "My new bounty");

    // Click the "Discard" button
    const discardButton = screen.getByRole("button", { name: /discard/i });
    await user.click(discardButton);

    // Discard button should disappear
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();

    // Navigate away via bounty card — should NOT prompt
    await user.click(screen.getByLabelText(/some bounty/i));

    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("shows the Discard button only when form is dirty", async () => {
    const user = userEvent.setup();
    await renderBoard();

    // Discard button should not be visible initially
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();

    // Modify the form
    const titleInput = screen.getByPlaceholderText("Add WebSocket updates...");
    await user.type(titleInput, "x");

    // Discard button should appear
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("prompts with confirm dialog and navigates away when confirmed", async () => {
    vi.mocked(window.confirm).mockReturnValue(true); // user clicks "OK"
    const user = userEvent.setup();
    await renderBoard();

    const titleInput = screen.getByPlaceholderText("Add WebSocket updates...");
    await user.type(titleInput, "My new bounty");

    // Click bounty card to navigate to detail page
    await user.click(screen.getByLabelText(/some bounty/i));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    // Navigation should have happened
    expect(window.location.pathname).toBe("/bounties/BNTY-300");
  });

  it("prompts with confirm dialog and stays on page when cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false); // user clicks "Cancel"
    const user = userEvent.setup();
    await renderBoard();

    const titleInput = screen.getByPlaceholderText("Add WebSocket updates...");
    await user.type(titleInput, "My new bounty");

    // Click bounty card to navigate to detail page
    await user.click(screen.getByLabelText(/some bounty/i));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    // Navigation should NOT have happened
    expect(window.location.pathname).toBe("/");
  });
});