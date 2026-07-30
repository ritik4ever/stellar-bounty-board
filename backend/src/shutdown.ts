export let draining = false;
export const DRAIN_TIMEOUT_MS = 30_000;

export function setDraining(): void {
  draining = true;
}
