import { useEffect } from "react";

/**
 * Registers a `beforeunload` handler that prompts the user when
 * `shouldPrompt` is true.  No-op when `shouldPrompt` is false.
 */
export function useBeforeUnload(shouldPrompt: boolean): void {
  useEffect(() => {
    if (!shouldPrompt) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Modern browsers ignore the string; the empty returnValue is what
      // triggers the native "Leave site?" dialog.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldPrompt]);
}