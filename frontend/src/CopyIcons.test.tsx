import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CopyIcon from "./CopyIcons";

describe("CopyIcon", () => {
  it("copies text with the async clipboard API", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<CopyIcon text="BNTY-380" label="bounty ID" />);
    await user.click(screen.getByRole("button", { name: "Copy bounty ID" }));

    expect(writeText).toHaveBeenCalledWith("BNTY-380");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument());
  });

  it("falls back to a temporary textarea when clipboard access fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    render(<CopyIcon text="fallback text" />);
    await user.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });
});
