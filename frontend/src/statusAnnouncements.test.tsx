import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBountyStatusAnnouncement,
  STATUS_ANNOUNCEMENT_CLEAR_MS,
  StatusAnnouncement,
  useStatusAnnouncement,
} from "./statusAnnouncements";

afterEach(() => {
  vi.useRealTimers();
});

function AnnouncementHarness() {
  const { announcement, announceStatus } = useStatusAnnouncement();

  return (
    <>
      <button
        type="button"
        onClick={() => announceStatus("Bounty #42 status changed to Reserved")}
      >
        Mock status change
      </button>
      <StatusAnnouncement announcement={announcement} />
    </>
  );
}

describe("status announcements", () => {
  it("formats the first detected bounty status change", () => {
    const message = getBountyStatusAnnouncement(
      [{ id: "bounty-1", issueNumber: 42, status: "open" }],
      [{ id: "bounty-1", issueNumber: 42, status: "reserved" }],
    );

    expect(message).toBe("Bounty #42 status changed to Reserved");
  });

  it("announces a mocked status change and clears it after 3 seconds", () => {
    vi.useFakeTimers();

    render(<AnnouncementHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Mock status change" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Bounty #42 status changed to Reserved",
    );

    act(() => {
      vi.advanceTimersByTime(STATUS_ANNOUNCEMENT_CLEAR_MS);
    });

    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
