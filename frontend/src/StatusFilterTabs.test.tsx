import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import StatusFilterTabs from "./StatusFilterTabs";

describe("StatusFilterTabs", () => {
  it("renders six tabs in the expected order", () => {
    render(<StatusFilterTabs status="all" onChange={vi.fn()} />);

    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "All",
      "Open",
      "Reserved",
      "Submitted",
      "Released",
      "Expired",
    ]);
  });

  it("calls onChange with the matching value for each tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StatusFilterTabs status="all" onChange={onChange} />);

    const expectedValues = ["all", "open", "reserved", "submitted", "released", "expired"] as const;

    for (const [index, expectedValue] of expectedValues.entries()) {
      await user.click(screen.getAllByRole("tab")[index]);
      expect(onChange).toHaveBeenLastCalledWith(expectedValue);
    }
  });

  it("marks the active tab when status is open", () => {
    render(<StatusFilterTabs status="open" onChange={vi.fn()} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveClass("filter-chip--active");

    tabs.forEach((tab, index) => {
      if (index !== 1) {
        expect(tab).toHaveAttribute("aria-selected", "false");
        expect(tab).not.toHaveClass("filter-chip--active");
      }
    });
  });
});
