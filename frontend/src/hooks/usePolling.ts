import { useEffect, useRef, useCallback } from "react";

const DEFAULT_INTERVAL_MS = 30_000;

function getIntervalMs(): number {
  const envVal = import.meta.env.VITE_POLL_INTERVAL_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed >= 1_000) {
      return parsed;
    }
  }
  return DEFAULT_INTERVAL_MS;
}

/**
 * Polls a fetch function at a configured interval.
 *
 * - Polling is paused when the browser tab is hidden (visibilitychange).
 * - Polling stops on component unmount.
 * - Configurable via `VITE_POLL_INTERVAL_MS` env var (default 30s, min 1s).
 *
 * @param fetchFn - An async function that returns fresh data.
 * @param enabled - Whether polling should be active (default true).
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  enabled = true,
): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;

    // Fetch immediately on start
    fetchFnRef.current().catch(() => {
      /* silent — consumer handles its own errors */
    });

    intervalRef.current = setInterval(() => {
      fetchFnRef.current().catch(() => {
        /* silent */
      });
    }, getIntervalMs());
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      return;
    }

    startPolling();

    // Pause/resume on tab visibility change
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, startPolling, stopPolling]);
}
