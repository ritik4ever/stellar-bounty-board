import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
};

const actionCopy: Record<BountyStatus, []> = {
  open: [],
  reserved: [],
  submitted: [],
  released: [],
  refunded: [],
  expired: [],
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

function detailProps(detailBounty: Bounty = bounty) {
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
  };
}

function renderDetail(detailBounty: Bounty = bounty) {
  return render(
    <BountyDetailPage {...detailProps(detailBounty)} />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BountyDetailPage copy actions", () => {
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

  it("renders the repository avatar with stable lazy-loading image attributes", () => {
    render(
      <BountyDetailPage
        {...detailProps()}
        avatarUrl="https://github.com/ritik4ever.png?size=72"
      />,
    );

    const avatar = screen.getByRole("img", { name: "ritik4ever" });

    expect(avatar).toHaveAttribute("src", "https://github.com/ritik4ever.png?size=56");
    expect(avatar).toHaveAttribute(
      "srcset",
      "https://github.com/ritik4ever.png?size=56 56w, https://github.com/ritik4ever.png?size=112 112w",
    );
    expect(avatar).toHaveAttribute("sizes", "56px");
    expect(avatar).toHaveAttribute("loading", "lazy");
    expect(avatar).toHaveAttribute("decoding", "async");
    expect(avatar).toHaveAttribute("width", "56");
    expect(avatar).toHaveAttribute("height", "56");
  });

  it("shows a placeholder avatar when the repository avatar fails to load", () => {
    render(
      <BountyDetailPage
        {...detailProps()}
        avatarUrl="https://github.com/ritik4ever.png?size=72"
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "ritik4ever" }));

    expect(screen.getByRole("img", { name: "ritik4ever avatar placeholder" })).toHaveTextContent("RI");
  });

  it("shows a placeholder avatar when no repository avatar URL is available", () => {
    renderDetail();

    expect(screen.getByRole("img", { name: "ritik4ever avatar placeholder" })).toHaveTextContent("RI");
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
});
