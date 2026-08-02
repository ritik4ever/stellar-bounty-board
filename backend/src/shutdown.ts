export let draining = false;

/** Grace period in milliseconds to allow in-flight requests to finish before forcing exit. */
export const DRAIN_TIMEOUT_MS = 10_000;

export function setDraining(): void {
  draining = true;
}
