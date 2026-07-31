import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SubmissionChecklistModal from "./SubmissionChecklistModal";
import type { Bounty } from "./types";

const bounty: Bounty = {
  id: "BNTY-300",
  repo: "ritik4ever/stellar-bounty-board",
  issueNumber: 300,
  title: "Keyboard navigation bounty",
  summary: "Make the bounty board fully keyboard navigable.",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  contributor: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY",
  tokenSymbol: "USDC",
  amount: 150,
  labels: [],
  status: "reserved",
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

function renderModal(overrides: Partial<React.ComponentProps<typeof SubmissionChecklistModal>> = {}) {
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
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

// A syntactically valid Stellar public key (starts with 'G', 56 chars).
const VALID_KEY = "GA" + "A".repeat(54);

async function fillIdentityFields(user: ReturnType<typeof userEvent.setup>) {
  const contributor = screen.getByLabelText(/contributor stellar address/i);
  await user.clear(contributor);
  await user.type(contributor, VALID_KEY);
  await user.type(
    screen.getByLabelText(/pull request or demo url/i),
    "https://github.com/owner/repo/pull/1",
  );
}

// Fill in valid required fields and check every checklist item so the
// Submit button becomes enabled (and therefore part of the focus order).
async function completeForm(user: ReturnType<typeof userEvent.setup>) {
  await fillIdentityFields(user);
  for (const checkbox of screen.getAllByRole("checkbox")) {
    await user.click(checkbox);
  }
}

describe("SubmissionChecklistModal keyboard accessibility", () => {
  it("focuses the first input and traps focus while tabbing", async () => {
    const user = userEvent.setup();
    renderModal();

    const contributorInput = screen.getByLabelText(/contributor stellar address/i);
    await waitFor(() => expect(contributorInput).toHaveFocus());

    await completeForm(user);

    // completeForm leaves focus on the last checklist toggle; reset to the top.
    contributorInput.focus();
    fireEvent.keyDown(contributorInput, { key: "Tab" });
    expect(screen.getByLabelText(/pull request or demo url/i)).toHaveFocus();

    fireEvent.keyDown(screen.getByLabelText(/pull request or demo url/i), { key: "Tab" });
    expect(screen.getByRole("checkbox", { name: /pr is linked to the correct issue/i })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("checkbox", { name: /pr is linked to the correct issue/i }), { key: "Tab" });
    expect(screen.getByLabelText(/notes for the maintainer/i)).toHaveFocus();

    fireEvent.keyDown(screen.getByLabelText(/notes for the maintainer/i), { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Tab" });
    expect(screen.getByRole("button", { name: "Submit work" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Submit work" }), { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Tab" });
    expect(contributorInput).toHaveFocus();

    fireEvent.keyDown(contributorInput, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Submit work" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Submit work" }), { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Tab", shiftKey: true });
    expect(screen.getByLabelText(/notes for the maintainer/i)).toHaveFocus();
  });

  it("closes through Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = renderModal();

    await waitFor(() => expect(screen.getByLabelText(/contributor stellar address/i)).toHaveFocus());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SubmissionChecklistModal pre-flight validation", () => {
  const requiredItems = [
    /pr is linked to the correct issue/i,
    /pr description explains the changes/i,
    /all ci checks pass/i,
  ];

  it("renders all three required checklist items", () => {
    renderModal();
    for (const item of requiredItems) {
      expect(screen.getByRole("checkbox", { name: item })).toBeInTheDocument();
    }
  });

  it("blocks submission until every checklist item is checked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    // Valid identity fields, but no checklist items ticked yet.
    await fillIdentityFields(user);

    const submit = screen.getByRole("button", { name: "Submit work" });
    expect(submit).toBeDisabled();

    // Check items one at a time — submission stays blocked until the last one.
    const checkboxes = requiredItems.map((item) => screen.getByRole("checkbox", { name: item }));
    await user.click(checkboxes[0]);
    expect(submit).toBeDisabled();
    await user.click(checkboxes[1]);
    expect(submit).toBeDisabled();

    // Attempting to submit while still incomplete must not fire onSubmit.
    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(checkboxes[2]);
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps submission blocked when checklist is complete but PR link is missing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    const contributor = screen.getByLabelText(/contributor stellar address/i);
    await user.clear(contributor);
    await user.type(contributor, VALID_KEY);
    for (const item of requiredItems) {
      await user.click(screen.getByRole("checkbox", { name: item }));
    }

    const submit = screen.getByRole("button", { name: "Submit work" });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit when the modal is cancelled", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSubmit, onClose });

    await fillIdentityFields(user);
    for (const item of requiredItems) {
      await user.click(screen.getByRole("checkbox", { name: item }));
    }

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
