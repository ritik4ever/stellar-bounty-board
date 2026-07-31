import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePolling } from './usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Ensure document is not hidden by default in tests
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should poll the fetch function at the configured interval', () => {
    const fetchFn = vi.fn();
    renderHook(() => usePolling(fetchFn, 5000));

    expect(fetchFn).not.toHaveBeenCalled();

    // Advance by less than interval
    vi.advanceTimersByTime(4000);
    expect(fetchFn).not.toHaveBeenCalled();

    // Advance to interval
    vi.advanceTimersByTime(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance again
    vi.advanceTimersByTime(5000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('should fallback to 30 seconds if no interval is configured', () => {
    const fetchFn = vi.fn();
    renderHook(() => usePolling(fetchFn));

    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(29000);
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('should respect VITE_POLL_INTERVAL_MS env var if no intervalMs prop is passed', () => {
    // Mock the environment variable
    vi.stubEnv('VITE_POLL_INTERVAL_MS', '15000');

    const fetchFn = vi.fn();
    renderHook(() => usePolling(fetchFn));

    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(14000);
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    
    vi.unstubAllEnvs();
  });

  it('should prioritize intervalMs prop over VITE_POLL_INTERVAL_MS env var', () => {
    vi.stubEnv('VITE_POLL_INTERVAL_MS', '15000');

    const fetchFn = vi.fn();
    renderHook(() => usePolling(fetchFn, 5000));

    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4000);
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    
    vi.unstubAllEnvs();
  });

  it('should pause polling when the browser tab is not visible', () => {
    const fetchFn = vi.fn();
    const { unmount } = renderHook(() => usePolling(fetchFn, 5000));

    // First interval works
    vi.advanceTimersByTime(5000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Hide tab
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Advance time - should not call fetchFn
    vi.advanceTimersByTime(10000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Show tab again
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Advance time - should resume polling and call fetchFn
    vi.advanceTimersByTime(5000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('should stop polling on component unmount', () => {
    const fetchFn = vi.fn();
    const { unmount } = renderHook(() => usePolling(fetchFn, 5000));

    vi.advanceTimersByTime(5000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(10000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
