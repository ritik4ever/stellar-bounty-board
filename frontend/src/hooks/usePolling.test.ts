import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePolling } from "./usePolling";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock document.hidden
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls fetchFn immediately on mount", () => {
    const fetchFn = vi.fn().mockResolvedValue("ok");

    renderHook(() => usePolling(fetchFn));

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("polls fetchFn at the default interval (30s)", () => {
    const fetchFn = vi.fn().mockResolvedValue("ok");

    renderHook(() => usePolling(fetchFn));

    expect(fetchFn).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not poll when enabled is false", () => {
    const fetchFn = vi.fn().mockResolvedValue("ok");

    renderHook(() => usePolling(fetchFn, false));

    expect(fetchFn).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("pauses polling when the tab becomes hidden, resumes when visible", () => {
    const fetchFn = vi.fn().mockResolvedValue("ok");

    renderHook(() => usePolling(fetchFn));

    // Initial call
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Simulate tab hidden
    act(() => {
      Object.defineProperty(document, "hidden", { value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance time — should NOT trigger polling
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Simulate tab visible again
    act(() => {
      Object.defineProperty(document, "hidden", { value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should fetch immediately on resume
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // And continue polling
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("stops polling on unmount", () => {
    const fetchFn = vi.fn().mockResolvedValue("ok");

    const { unmount } = renderHook(() => usePolling(fetchFn));

    expect(fetchFn).toHaveBeenCalledTimes(1);

    unmount();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Should not have called again after unmount
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
