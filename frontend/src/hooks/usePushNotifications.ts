/**
 * usePushNotifications – React hook for browser push notification opt-in.
 *
 * Provides:
 *  - isSupported: whether the browser supports Push API + Service Worker
 *  - permission: Notification.permission value
 *  - isSubscribed: whether the user has an active push subscription
 *  - subscribe(): request permission + register push subscription
 *  - unsubscribe(): revoke push subscription
 *  - isLoading: loading state for async operations
 *  - error: error message from last operation
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { registerPushSubscription, unregisterPushSubscription } from "../api";

declare global {
  interface ServiceWorkerRegistration {
    pushManager: PushManager;
  }
}

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ??
  "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushNotificationState {
  isSupported: boolean;
  permission: NotificationPermission | "unsupported";
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface PushNotificationActions {
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): PushNotificationState & PushNotificationActions {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Detect support and restore existing subscription
  useEffect(() => {
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    if (!supported) {
      setIsSupported(false);
      setPermission("unsupported");
      return;
    }

    setIsSupported(true);
    setPermission(Notification.permission);

    // Restore any existing subscription
    navigator.serviceWorker.ready
      .then((reg) => {
        swRegistrationRef.current = reg;
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        setIsSubscribed(sub !== null);
      })
      .catch(() => {
        // Service worker not registered yet — that's fine
      });
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // 1. Request notification permission
      if (Notification.permission === "denied") {
        throw new Error(
          "Notifications are blocked in your browser settings. Please unblock them in the site permissions."
        );
      }

      if (Notification.permission !== "granted") {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== "granted") {
          throw new Error("Notification permission was denied.");
        }
      }

      // 2. Ensure service worker is active
      let reg = swRegistrationRef.current;
      if (!reg) {
        reg = await navigator.serviceWorker.ready;
        swRegistrationRef.current = reg;
      }

      // 3. Subscribe to push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY
          ? urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          : undefined,
      });

      // 4. Send subscription to backend
      await registerPushSubscription({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey("p256dh")!),
          auth: arrayBufferToBase64(subscription.getKey("auth")!),
        },
      });

      setIsSubscribed(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to subscribe to push notifications.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const reg = swRegistrationRef.current ?? (await navigator.serviceWorker.ready);
      swRegistrationRef.current = reg;

      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        setIsSubscribed(false);
        return;
      }

      // Tell the backend first
      await unregisterPushSubscription(subscription.endpoint);

      // Then unsubscribe from the push service
      await subscription.unsubscribe();

      setIsSubscribed(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to unsubscribe from push notifications.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}