import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SubmissionChecklistModal from "./SubmissionChecklistModal";
import type { ComponentProps } from "react";
import type { Bounty } from "./types";

const validContributor = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const bounty: Bounty = {
  id: "BNTY-1",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 380,
  title: "Add frontend coverage gate",
  summary: "Summary",
  maintainer: validContributor,
  contributor: undefined,
  tokenSymbol: "USDC",
  amount: 75,
  labels: [],
  status: "open",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

function renderModal(overrides: Partial<ComponentProps<typeof SubmissionChecklistModal>> = {}) {
  return render(
    <SubmissionChecklistModal
      bounty={bounty}
      submitting={false}
      error={null}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SubmissionChecklistModal", () => {
  it("shows an error banner and disables controls while submitting", () => {
    const onClose = vi.fn();
    renderModal({ submitting: true, error: "Submission failed", onClose });

    expect(screen.getByRole("alert")).toHaveTextContent("Submission failed");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
  });

  it("validates required fields before submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    await user.click(screen.getByRole("button", { name: "Submit work" }));

    expect(await screen.findByText("Contributor address is required")).toBeInTheDocument();
    expect(screen.getByText("PR or demo link is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed form values when the checklist is valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    await user.type(screen.getByLabelText(/Contributor Stellar address/), ` ${validContributor} `);
    await user.type(screen.getByLabelText(/Pull request or demo URL/), " https://github.com/owner/repo/pull/123 ");
    await user.click(screen.getByRole("checkbox", { name: "Tests written or updated" }));
    await user.type(screen.getByLabelText(/Notes for the maintainer/), " Ready for review ");
    await user.click(screen.getByRole("button", { name: "Submit work" }));

    expect(onSubmit).toHaveBeenCalledWith({
      contributor: validContributor,
      prLink: "https://github.com/owner/repo/pull/123",
      testsWritten: true,
      notes: "Ready for review",
    });
  });

  it("uses initial values and calls close from the cancel button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({
      onClose,
      initialData: {
        contributor: validContributor,
        prLink: "https://github.com/owner/repo/pull/456",
        testsWritten: true,
        notes: "Existing note",
      },
    });

    expect(screen.getByDisplayValue(validContributor)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Tests written or updated" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
