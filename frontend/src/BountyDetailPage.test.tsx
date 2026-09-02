import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import BountyDetailPage from "./BountyDetailPage";
import type { Bounty, BountyStatus } from "./types";

const statusCopy: Record<BountyStatus, { label: string; description: string }> = {
  open: { label: "Open", description: "Ready for contributors." },
  reserved: { label: "Reserved", description: "Reserved by a contributor." },
  submitted: { label: "Submitted", description: "Submission under review." },
  released: { label: "Released", description: "Funds released." },
  refunded: { label: "Refunded", description: "Funds refunded." },
  expired: { label: "Expired", description: "Past deadline." },
  disputed: { label: "Disputed", description: "In dispute resolution." },
};

const actionCopy: Record<BountyStatus, []> = {
  open: [],
  reserved: [],
  submitted: [],
  released: [],
  refunded: [],
  expired: [],
  disputed: [],
};

const bounty: Bounty = {
  id: "BNTY-42",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 73,
  title: "Copy button test bounty",
  summary: "Make important identifiers easy to copy.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contributor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK",
  tokenSymbol: "XLM",
  amount: 150,
  labels: [],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 1_700_086_400,
  version: 1,
  events: [],
};

const similarBounty: Bounty = {
  id: "BNTY-99",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 99,
  title: "Similar bounty for testing",
  summary: "Another bounty with similar characteristics.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contributor: undefined,
  tokenSymbol: "XLM",
  amount: 200,
  labels: [{ name: "frontend", color: "blue" }],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 1_700_086_400,
  version: 1,
  events: [],
};

function detailProps(detailBounty: Bounty = bounty, extraBounties?: Bounty[]) {
  return {
    bounty: detailBounty,
    loading: false,
    onBack: () => undefined,
    owner: "ritik4ever",
    avatarUrl: "",
    statusCopy,
    actionCopy,
    renderActionButton: () => null,
    formatTimestamp: () => "Jan 1, 2024",
    bounties: extraBounties,
  };
}

function renderDetail(detailBounty: Bounty = bounty, extraBounties?: Bounty[]) {
  return render(
    <BountyDetailPage {...detailProps(detailBounty, extraBounties)} />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BountyDetailPage copy actions", () => {
  it("copies the bounty URL from the share button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: /share bounty/i }));

    expect(writeText).toHaveBeenCalledWith(
      `http://localhost:3000/bounties/${encodeURIComponent("BNTY-42")}`
    );
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });

  it("shows fallback prompt when clipboard API fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => null);

    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: /share bounty/i }));

    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledWith(
        "Copy the bounty URL manually:",
        expect.stringContaining("/bounties/BNTY-42")
      );
    });

    promptSpy.mockRestore();
  });

  it("copies the bounty ID from the detail metadata", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: /copy bounty id/i }));

    expect(writeText).toHaveBeenCalledWith("BNTY-42");
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });

  it("copies the maintainer wallet address from the detail metadata", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: /copy maintainer wallet address/i }));

    expect(writeText).toHaveBeenCalledWith(bounty.maintainer);
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });

  it("prints the detail view from the export button", async () => {
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true });

    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: /print \/ export pdf/i }));

    expect(print).toHaveBeenCalledOnce();
  });

  it("announces status changes for assistive technology", () => {
    const { rerender } = renderDetail();
    const reservedBounty: Bounty = {
      ...bounty,
      status: "reserved",
      reservedAt: 1_700_000_100,
      version: 2,
    };

    rerender(<BountyDetailPage {...detailProps(reservedBounty)} />);

    expect(
      screen.getByText("Bounty #73 status changed to Reserved"),
    ).toBeInTheDocument();
  });

  it("clears the status announcement after three seconds", () => {
    vi.useFakeTimers();
    const { rerender } = renderDetail();
    const reservedBounty: Bounty = {
      ...bounty,
      status: "reserved",
      reservedAt: 1_700_000_100,
      version: 2,
    };

    rerender(<BountyDetailPage {...detailProps(reservedBounty)} />);

    expect(screen.getByText("Bounty #73 status changed to Reserved")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.queryByText("Bounty #73 status changed to Reserved")).not.toBeInTheDocument();
  });

  describe("More like this section", () => {
    it("does not render when no bounties prop is provided", () => {
      renderDetail(bounty);
      expect(screen.queryByText("More like this")).not.toBeInTheDocument();
    });

    it("does not render when the current bounty is the only bounty", () => {
      renderDetail(bounty, [bounty]);
      expect(screen.queryByText("More like this")).not.toBeInTheDocument();
    });

    it("renders similar bounties when matching bounties are available", () => {
      renderDetail(bounty, [bounty, similarBounty]);
      expect(screen.getByText("More like this")).toBeInTheDocument();
      expect(screen.getByText("Similar bounty for testing")).toBeInTheDocument();
    });

    it("excludes the current bounty from the similar list", () => {
      renderDetail(bounty, [bounty, similarBounty]);
      const moreLikeThis = screen.getByText("More like this").closest("section")!;
      expect(moreLikeThis).not.toHaveTextContent("Copy button test bounty");
      // The current bounty title should only appear in the detail section, not in "More like this"
      expect(screen.getByText("Copy button test bounty")).toBeInTheDocument();
    });
  });
});
