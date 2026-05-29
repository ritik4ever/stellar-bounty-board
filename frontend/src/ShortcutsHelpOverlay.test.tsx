import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";

describe("ShortcutsHelpOverlay", () => {
  it("renders nothing when isOpen is false", () => {
    render(<ShortcutsHelpOverlay isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the overlay when isOpen is true", () => {
    render(<ShortcutsHelpOverlay isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Keyboard shortcuts"),
    ).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelpOverlay isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelpOverlay isOpen={true} onClose={onClose} />);
    fireEvent.click(
      screen.getByRole("button", { name: /close keyboard shortcuts overlay/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ShortcutsHelpOverlay isOpen={true} onClose={onClose} />,
    );
    // The backdrop is the outermost div (presentation role)
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when clicking inside the dialog card", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelpOverlay isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lists the ? and / keyboard shortcuts", () => {
    render(<ShortcutsHelpOverlay isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Open / close this help overlay")).toBeInTheDocument();
    expect(screen.getByText("Focus the search bar")).toBeInTheDocument();
  });

  it("lists status filter shortcuts 1-5", () => {
    render(<ShortcutsHelpOverlay isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/status filter to "All"/i)).toBeInTheDocument();
    expect(screen.getByText(/status filter to "Open"/i)).toBeInTheDocument();
    expect(screen.getByText(/status filter to "Released"/i)).toBeInTheDocument();
  });

  it("has correct ARIA attributes for accessibility", () => {
    render(<ShortcutsHelpOverlay isOpen={true} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });
});
