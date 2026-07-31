import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pad = (n: number) => String(n).padStart(2, "0");
function toLocal(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

import { ExtendDeadlineControl } from "./BountyDetailPage";
import type { Bounty } from "./types";

const extendDeadlineMock = vi.fn();

vi.mock("./api", () => ({
  extendDeadline: (...args: unknown[]) => extendDeadlineMock(...args),
}));

const CURRENT_DEADLINE = 1_900_000_000; // seconds

const bounty: Bounty = {
  id: "BNT-0042",
  repo: "owner/repo",
  issueNumber: 42,
  title: "Extend deadline test bounty",
  summary: "A bounty for exercising the extend-deadline control.",
  maintainer: "GA" + "A".repeat(54),
  contributor: undefined,
  tokenSymbol: "USDC",
  amount: 100,
  labels: [],
  status: "open",
  createdAt: 1_800_000_000,
  deadlineAt: CURRENT_DEADLINE,
  version: 1,
  events: [],
};

const formatTimestamp = (value?: number) => `ts:${value ?? "n/a"}`;

function renderControl() {
  return render(<ExtendDeadlineControl bounty={bounty} formatTimestamp={formatTimestamp} />);
}

beforeEach(() => {
  extendDeadlineMock.mockReset();
});

describe("ExtendDeadlineControl", () => {
  it("submits a later deadline and reports success", async () => {
    const newDeadline = CURRENT_DEADLINE + 7 * 24 * 60 * 60;
    extendDeadlineMock.mockResolvedValue({ ...bounty, deadlineAt: newDeadline });

    const user = userEvent.setup();
    renderControl();

    const input = screen.getByLabelText(/extend deadline/i);
    fireEvent.change(input, { target: { value: toLocal(newDeadline) } });
    await user.click(screen.getByRole("button", { name: /extend deadline/i }));

    await waitFor(() => expect(extendDeadlineMock).toHaveBeenCalledTimes(1));
    const [id, maintainer, sentDeadline] = extendDeadlineMock.mock.calls[0];
    expect(id).toBe(bounty.id);
    expect(maintainer).toBe(bounty.maintainer);
    // datetime-local has minute precision, so the sent value is the chosen
    // minute (>= the current deadline) rather than the exact second.
    expect(sentDeadline).toBe(Math.floor(new Date(toLocal(newDeadline)).getTime() / 1000));
    expect(sentDeadline).toBeGreaterThan(CURRENT_DEADLINE);

    expect(await screen.findByRole("status")).toHaveTextContent(/Deadline extended/i);
  });

  it("does not submit and surfaces an error when no date is chosen", async () => {
    const user = userEvent.setup();
    renderControl();

    // Enable the button without a value to prove the guard rejects empty input.
    const submit = screen.getByRole("button", { name: /extend deadline/i });
    submit.removeAttribute("disabled");
    await user.click(submit);

    expect(extendDeadlineMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/pick a new deadline/i);
  });

  it("disables the submit button until a date is chosen", () => {
    renderControl();
    expect(screen.getByRole("button", { name: /extend deadline/i })).toBeDisabled();
  });
});
