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

describe("SubmissionChecklistModal evidence attachment", () => {
  function createMockFile(name: string, size: number, type: string): File {
    const file = new File(["x".repeat(size)], name, { type });
    return file;
  }

  it("renders the evidence file input", () => {
    renderModal();
    const fileInput = screen.getByLabelText(/supporting evidence/i);
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("type", "file");
    expect(fileInput).toHaveAttribute("accept", ".pdf,.png,.jpg,.jpeg");
  });

  it("accepts a valid PDF file", async () => {
    const user = userEvent.setup();
    renderModal();

    const validFile = createMockFile("evidence.pdf", 1024 * 1024, "application/pdf"); // 1MB
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, validFile);

    expect(screen.getByText("evidence.pdf")).toBeInTheDocument();
    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/file type not supported/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/file is too large/i)).not.toBeInTheDocument();
  });

  it("accepts a valid PNG file", async () => {
    const user = userEvent.setup();
    renderModal();

    const validFile = createMockFile("screenshot.png", 500 * 1024, "image/png"); // 500KB
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, validFile);

    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText(/500\.0 KB/)).toBeInTheDocument();
    expect(screen.queryByText(/file type not supported/i)).not.toBeInTheDocument();
  });

  it("accepts a valid JPG file", async () => {
    const user = userEvent.setup();
    renderModal();

    const validFile = createMockFile("photo.jpg", 2 * 1024 * 1024, "image/jpeg"); // 2MB
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, validFile);

    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/file type not supported/i)).not.toBeInTheDocument();
  });

  it("rejects a file that is too large", async () => {
    const user = userEvent.setup();
    renderModal();

    const oversizedFile = createMockFile("large.pdf", 11 * 1024 * 1024, "application/pdf"); // 11MB
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, oversizedFile);

    expect(screen.getByText(/file is too large\. maximum size is 10 mb/i)).toBeInTheDocument();
    expect(screen.queryByText("large.pdf")).not.toBeInTheDocument();
  });

  it("rejects an unsupported file type by MIME", async () => {
    const user = userEvent.setup();
    renderModal();

    const unsupportedFile = createMockFile("document.docx", 1024, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, unsupportedFile);

    expect(screen.getByText(/file type not supported\. please upload pdf, png, or jpg/i)).toBeInTheDocument();
    expect(screen.queryByText("document.docx")).not.toBeInTheDocument();
  });

  it("rejects an unsupported file type by extension", async () => {
    const user = userEvent.setup();
    renderModal();

    const unsupportedFile = createMockFile("script.txt", 1024, "text/plain");
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, unsupportedFile);

    expect(screen.getByText(/file type not supported\. please upload pdf, png, or jpg/i)).toBeInTheDocument();
    expect(screen.queryByText("script.txt")).not.toBeInTheDocument();
  });

  it("does not trigger network request when file is invalid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    await fillIdentityFields(user);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      await user.click(checkbox);
    }

    // Upload invalid file
    const invalidFile = createMockFile("large.pdf", 11 * 1024 * 1024, "application/pdf");
    const fileInput = screen.getByLabelText(/supporting evidence/i);
    await user.upload(fileInput, invalidFile);

    // Error should be shown
    expect(screen.getByText(/file is too large/i)).toBeInTheDocument();

    // Try to submit - should still work (evidence is optional)
    const submit = screen.getByRole("button", { name: "Submit work" });
    await user.click(submit);

    // Submission should happen without the invalid file
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      contributor: VALID_KEY,
      prLink: "https://github.com/owner/repo/pull/1",
      testsWritten: false,
      notes: "",
      evidenceFile: undefined,
    });
  });

  it("displays evidence summary for valid file", async () => {
    const user = userEvent.setup();
    renderModal();

    const validFile = createMockFile("evidence.pdf", 1024 * 1024, "application/pdf");
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, validFile);

    // Summary should show file details
    expect(screen.getByText("evidence.pdf")).toBeInTheDocument();
    expect(screen.getByText(/1\.0 MB • application\/pdf/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove evidence file/i })).toBeInTheDocument();
  });

  it("allows removing a selected file", async () => {
    const user = userEvent.setup();
    renderModal();

    const validFile = createMockFile("evidence.pdf", 1024 * 1024, "application/pdf");
    const fileInput = screen.getByLabelText(/supporting evidence/i);

    await user.upload(fileInput, validFile);
    expect(screen.getByText("evidence.pdf")).toBeInTheDocument();

    const removeButton = screen.getByRole("button", { name: /remove evidence file/i });
    await user.click(removeButton);

    expect(screen.queryByText("evidence.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove evidence file/i })).not.toBeInTheDocument();
  });

  it("clears error when removing file", async () => {
    const user = userEvent.setup();
    renderModal();

    // Upload invalid file
    const invalidFile = createMockFile("large.pdf", 11 * 1024 * 1024, "application/pdf");
    const fileInput = screen.getByLabelText(/supporting evidence/i);
    await user.upload(fileInput, invalidFile);

    expect(screen.getByText(/file is too large/i)).toBeInTheDocument();

    // Upload valid file to trigger removal of previous error
    const validFile = createMockFile("valid.pdf", 1024, "application/pdf");
    await user.upload(fileInput, validFile);

    expect(screen.queryByText(/file is too large/i)).not.toBeInTheDocument();
    expect(screen.getByText("valid.pdf")).toBeInTheDocument();
  });

  it("includes valid evidence file in submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    await fillIdentityFields(user);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      await user.click(checkbox);
    }

    const validFile = createMockFile("evidence.pdf", 1024, "application/pdf");
    const fileInput = screen.getByLabelText(/supporting evidence/i);
    await user.upload(fileInput, validFile);

    const submit = screen.getByRole("button", { name: "Submit work" });
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    const submittedData = onSubmit.mock.calls[0][0];
    expect(submittedData.evidenceFile).toBeInstanceOf(File);
    expect(submittedData.evidenceFile?.name).toBe("evidence.pdf");
  });

  it("allows submission without evidence file", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    await fillIdentityFields(user);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      await user.click(checkbox);
    }

    const submit = screen.getByRole("button", { name: "Submit work" });
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      contributor: VALID_KEY,
      prLink: "https://github.com/owner/repo/pull/1",
      testsWritten: false,
      notes: "",
      evidenceFile: undefined,
    });
  });
});
