import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SubmissionChecklistModal from "./SubmissionChecklistModal";
import type { Bounty } from "./types";

const validContributor = `G${"A".repeat(55)}`;

const bounty: Bounty = {
  id: "BNTY-285",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 285,
  title: "Submission checklist bounty",
  summary: "Block submission until checklist is complete.",
  maintainer: `G${"B".repeat(55)}`,
  contributor: validContributor,
  tokenSymbol: "XLM",
  amount: 100,
  labels: [],
  status: "reserved",
  createdAt: 1_700_000_000,
  deadlineAt: 1_700_086_400,
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

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
});

describe("SubmissionChecklistModal", () => {
  it("blocks submission until every checklist item is checked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderModal({ onSubmit });

    await user.clear(screen.getByLabelText(/contributor stellar address/i));
    await user.type(screen.getByLabelText(/contributor stellar address/i), validContributor);
    await user.type(screen.getByLabelText(/pull request or demo url/i), "https://github.com/owner/repo/pull/123");

    const submitButton = screen.getByRole("button", { name: /submit work/i });
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /pr is linked to the correct issue/i }));
    await user.click(screen.getByRole("checkbox", { name: /pr description explains the changes/i }));
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /all ci checks pass/i }));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      contributor: validContributor,
      prLink: "https://github.com/owner/repo/pull/123",
      issueLinked: true,
      descriptionExplainsChanges: true,
      ciChecksPass: true,
      notes: "",
    });
  });

  it("closes without submitting when canceled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    renderModal({ onClose, onSubmit });

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
