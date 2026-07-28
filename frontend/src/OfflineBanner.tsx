import { useState, useEffect, useCallback } from "react";
import { WifiOff } from "lucide-react";

export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && !navigator.onLine
  );

  const handleOnline = useCallback(() => setOffline(false), []);
  const handleOffline = useCallback(() => setOffline(true), []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  if (!offline) return null;

  return (
    <div className="offline-banner" role="alert" aria-live="polite">
      <WifiOff size={18} aria-hidden="true" />
      <span>
        You are offline. Showing cached data — some features may be unavailable.
      </span>
    </div>
  );
}