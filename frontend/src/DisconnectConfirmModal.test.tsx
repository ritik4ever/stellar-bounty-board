import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DisconnectConfirmModal from "./DisconnectConfirmModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof DisconnectConfirmModal>> = {},
) {
  return render(
    <DisconnectConfirmModal
      onConfirm={vi.fn()}
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

describe("DisconnectConfirmModal", () => {
  it("renders the title and body", () => {
    renderModal();
    expect(screen.getByText("Disconnect Wallet")).toBeInTheDocument();
    expect(
      screen.getByText(/are you sure you want to disconnect your wallet/i),
    ).toBeInTheDocument();
  });

  it("renders Cancel and Disconnect buttons", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when Disconnect is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderModal({ onConfirm });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps focus while tabbing", async () => {
    renderModal();

    // Cancel should be focused by default
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const disconnect = screen.getByRole("button", { name: "Disconnect" });
    const closeBtn = screen.getByRole("button", { name: "Close" });

    await waitFor(() => expect(cancel).toHaveFocus());

    // Tab: Cancel → Disconnect
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(disconnect).toHaveFocus();

    // Tab: Disconnect → Close (X)
    fireEvent.keyDown(disconnect, { key: "Tab" });
    expect(closeBtn).toHaveFocus();

    // Tab: Close → Cancel (wrap)
    fireEvent.keyDown(closeBtn, { key: "Tab" });
    expect(cancel).toHaveFocus();

    // Shift+Tab: Cancel → Close (wrap)
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(closeBtn).toHaveFocus();

    // Shift+Tab: Close → Disconnect
    fireEvent.keyDown(closeBtn, { key: "Tab", shiftKey: true });
    expect(disconnect).toHaveFocus();

    // Shift+Tab: Disconnect → Cancel
    fireEvent.keyDown(disconnect, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = renderModal();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});