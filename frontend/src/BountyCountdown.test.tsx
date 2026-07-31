import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import BountyCountdown from "./BountyCountdown";

describe("BountyCountdown", () => {
  const mockNow = new Date("2024-01-01T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders correct countdown for a future deadline", () => {
    const deadline = (mockNow + 3 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000 + 5 * 60 * 1000) / 1000;
    render(<BountyCountdown deadlineAt={deadline} status="open" />);
    expect(screen.getByText("3d 14h 5m remaining")).toBeInTheDocument();
  });

  it("updates countdown every minute", () => {
    const deadline = (mockNow + 10 * 60 * 1000) / 1000;
    render(<BountyCountdown deadlineAt={deadline} status="open" />);
    expect(screen.getByText("10m remaining")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(screen.getByText("9m remaining")).toBeInTheDocument();
  });

  it("shows 'Expired' when deadline has passed", () => {
    const deadline = (mockNow - 1000) / 1000;
    render(<BountyCountdown deadlineAt={deadline} status="open" />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("applies urgent class when less than 24 hours remaining", () => {
    const deadline = (mockNow + 23 * 60 * 60 * 1000) / 1000;
    const { container } = render(<BountyCountdown deadlineAt={deadline} status="open" />);
    const span = container.querySelector(".countdown--urgent");
    expect(span).toBeInTheDocument();
    expect(screen.getByText("23h 0m remaining")).toBeInTheDocument();
  });

  it("does not show countdown for released status", () => {
    const deadline = (mockNow + 3600000) / 1000;
    const { container } = render(<BountyCountdown deadlineAt={deadline} status="released" />);
    expect(container.firstChild).toBeNull();
  });

  it("has aria-live='polite' for accessibility", () => {
    const deadline = (mockNow + 3600000) / 1000;
    render(<BountyCountdown deadlineAt={deadline} status="open" />);
    const countdownEl = screen.getByText(/remaining/);
    expect(countdownEl).toHaveAttribute("aria-live", "polite");
  });
});
