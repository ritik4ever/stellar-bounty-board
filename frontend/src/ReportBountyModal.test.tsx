import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportBountyModal from "./ReportBountyModal";
import type { Bounty } from "./types";

const mockBounty: Bounty = {
  id: "bounty-123",
  repo: "owner/repo",
  issueNumber: 42,
  title: "Test bounty",
  summary: "A test bounty",
  maintainer: "GA…maintainer",
  tokenSymbol: "XLM",
  amount: 100,
  labels: [],
  status: "open",
  createdAt: 1700000000,
  deadlineAt: 1700100000,
  version: 1,
  events: [],
};

// Helper: find submit button by text content (jsdom <dialog> has no role)
function getSubmitButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.primary-button[type="submit"]');
}

function getCancelButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.ghost-button');
}

describe("ReportBountyModal", () => {
  it("renders the modal with reason options", () => {
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Report this bounty")).toBeInTheDocument();
    expect(screen.getByText("Spam or duplicate")).toBeInTheDocument();
    expect(screen.getByText("Incorrect bounty amount")).toBeInTheDocument();
    expect(screen.getByText("Misleading description")).toBeInTheDocument();
    expect(screen.getByText("Maintainer not responding to submissions")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("shows submit button disabled when no reason is selected", () => {
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const submitButton = getSubmitButton();
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(true);
  });

  it("enables submit button when a reason is selected", async () => {
    const user = userEvent.setup();
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Spam or duplicate"));
    const submitButton = getSubmitButton();
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(false);
  });

  it("calls onSubmit with selected reason and details", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Spam or duplicate"));

    const detailsInput = screen.getByPlaceholderText(
      "Provide any additional context that helps the review...",
    );
    await user.type(detailsInput, "This bounty looks suspicious.");

    const submitButton = getSubmitButton();
    await user.click(submitButton!);

    expect(onSubmit).toHaveBeenCalledWith("spam", "This bounty looks suspicious.");
  });

  it("disables form controls while submitting", () => {
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={true}
        error={null}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const submitButton = getSubmitButton();
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(true);

    const textarea = screen.getByPlaceholderText(
      "Provide any additional context that helps the review...",
    );
    expect(textarea).toBeDisabled();
  });

  it("shows error banner when error is provided", () => {
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={false}
        error="Something went wrong"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ReportBountyModal
        bounty={mockBounty}
        submitting={false}
        error={null}
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );

    const cancelButton = getCancelButton();
    await user.click(cancelButton!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});