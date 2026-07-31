import { useEffect, useState } from "react";

const MQ = "(prefers-reduced-motion: reduce)";

/**
 * Returns `true` when the user has requested reduced motion via their OS
 * accessibility settings. Reacts to live changes (e.g. the user toggles the
 * setting while the app is open).
 *
 * Used by components that drive animation through JavaScript (e.g. class
 * toggling, inline styles). Pure CSS animations are handled by the
 * `@media (prefers-reduced-motion: reduce)` block in index.css.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MQ).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
