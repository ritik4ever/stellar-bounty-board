import { useEffect, useRef } from "react";

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export type PollingFetchFn = (signal: AbortSignal) => Promise<unknown> | unknown;

export function getPollingIntervalMs(value = import.meta.env.VITE_POLL_INTERVAL_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

export function usePolling(fetchFn: PollingFetchFn, intervalMs: number): void {
  const fetchFnRef = useRef(fetchFn);

  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }

    let stopped = false;
    let inFlight = false;
    let activeController: AbortController | null = null;

    const abortActivePoll = () => {
      activeController?.abort();
      activeController = null;
    };

    const poll = () => {
      if (stopped || inFlight || document.visibilityState === "hidden") {
        return;
      }

      inFlight = true;
      const controller = new AbortController();
      activeController = controller;

      void Promise.resolve(fetchFnRef.current(controller.signal))
        .catch(() => {
          // Polling is opportunistic; the owning view keeps initial-load errors visible.
        })
        .finally(() => {
          if (activeController === controller) {
            activeController = null;
          }
          inFlight = false;
        });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        abortActivePoll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(poll, intervalMs);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      abortActivePoll();
    };
  }, [intervalMs]);
}
