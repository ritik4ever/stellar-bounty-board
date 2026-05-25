import React from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePolling } from "./usePolling";

function PollingHarness({ fetchFn, intervalMs = 1000 }: { fetchFn: () => void; intervalMs?: number }) {
  usePolling(fetchFn, intervalMs);
  return null;
}

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibilityState("visible");
  });

  it("polls the fetch function on the configured interval", () => {
    const fetchFn = vi.fn();
    render(<PollingHarness fetchFn={fetchFn} intervalMs={500} />);

    vi.advanceTimersByTime(499);
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("pauses while the browser tab is hidden and resumes when visible", () => {
    const fetchFn = vi.fn();
    render(<PollingHarness fetchFn={fetchFn} intervalMs={1000} />);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(3000);
    expect(fetchFn).not.toHaveBeenCalled();

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("stops polling on unmount", () => {
    const fetchFn = vi.fn();
    const { unmount } = render(<PollingHarness fetchFn={fetchFn} intervalMs={1000} />);

    unmount();
    vi.advanceTimersByTime(3000);

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
