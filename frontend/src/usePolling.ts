import { useEffect, useRef } from "react";

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export function getPollIntervalMs(): number {
  const rawValue = import.meta.env.VITE_POLL_INTERVAL_MS;
  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return parsed;
}

export function usePolling(fetchFn: () => void | Promise<void>, intervalMs = getPollIntervalMs()) {
  const fetchRef = useRef(fetchFn);

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }

    let stopped = false;
    let timer: ReturnType<typeof window.setInterval> | undefined;

    const run = () => {
      if (stopped || document.visibilityState === "hidden") {
        return;
      }

      void fetchRef.current();
    };

    const start = () => {
      if (timer === undefined && document.visibilityState !== "hidden") {
        timer = window.setInterval(run, intervalMs);
      }
    };

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        start();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    start();

    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);
}
