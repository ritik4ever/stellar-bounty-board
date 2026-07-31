import { useEffect, useRef } from 'react';

/**
 * Custom React hook that polls a given function at a configured interval.
 * 
 * Features:
 * - Configurable via VITE_POLL_INTERVAL_MS env var, defaulting to intervalMs or 30000.
 * - Pauses polling when the browser tab is not visible (via visibilitychange).
 * - Stops polling on component unmount.
 * 
 * @param fetchFn - The function to call at each interval.
 * @param intervalMs - Optional interval in milliseconds. If not provided, it falls back to
 *                     VITE_POLL_INTERVAL_MS or 30000.
 */
export function usePolling(
  fetchFn: () => void | Promise<void>,
  intervalMs?: number
): void {
  const savedCallback = useRef(fetchFn);

  // Update ref to the latest callback if it changes
  useEffect(() => {
    savedCallback.current = fetchFn;
  }, [fetchFn]);

  // Determine the final interval duration
  const envInterval = import.meta.env.VITE_POLL_INTERVAL_MS;
  const parsedEnvInterval = envInterval ? parseInt(envInterval, 10) : undefined;
  
  // Priority: 1. Passed intervalMs, 2. Env variable, 3. Default (30 seconds)
  const finalIntervalMs = intervalMs ?? parsedEnvInterval ?? 30000;

  useEffect(() => {
    // If the interval duration is invalid, don't set up polling
    if (typeof finalIntervalMs !== 'number' || isNaN(finalIntervalMs) || finalIntervalMs <= 0) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (!intervalId) {
        intervalId = setInterval(() => {
          void savedCallback.current();
        }, finalIntervalMs);
      }
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    // Initialize polling if tab is visible
    if (!document.hidden) {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [finalIntervalMs]);
}
