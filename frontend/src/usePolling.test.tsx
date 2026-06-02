import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPollingIntervalMs, usePolling, type PollingFetchFn } from "./usePolling";

function PollingProbe({ fetchFn, intervalMs }: { fetchFn: PollingFetchFn; intervalMs: number }) {
  usePolling(fetchFn, intervalMs);
  return null;
}

async function advanceTimers(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("usePolling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses a 30 second default interval and accepts VITE_POLL_INTERVAL_MS overrides", () => {
    expect(getPollingIntervalMs()).toBe(30_000);
    expect(getPollingIntervalMs("45000")).toBe(45_000);
    expect(getPollingIntervalMs("not-a-number")).toBe(30_000);
  });

  it("polls the provided fetch function on the configured cadence", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn();

    render(<PollingProbe fetchFn={fetchFn} intervalMs={30_000} />);

    expect(fetchFn).not.toHaveBeenCalled();
    await advanceTimers(29_999);
    expect(fetchFn).not.toHaveBeenCalled();

    await advanceTimers(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await advanceTimers(30_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it("pauses polling while the browser tab is hidden", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn();
    const visibilityState = vi.spyOn(document, "visibilityState", "get");

    visibilityState.mockReturnValue("hidden");
    render(<PollingProbe fetchFn={fetchFn} intervalMs={30_000} />);

    await advanceTimers(30_000);
    expect(fetchFn).not.toHaveBeenCalled();

    visibilityState.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await advanceTimers(30_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("stops polling and aborts the active request on unmount", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });

    const { unmount } = render(<PollingProbe fetchFn={fetchFn} intervalMs={1_000} />);
    await advanceTimers(1_000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    unmount();
    expect(signals[0]?.aborted).toBe(true);

    await advanceTimers(3_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
