import { useEffect, useRef, useState } from 'react';

interface PushSubscriptionJson {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

const API_BASE = '/api/notification-preferences';

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      setPermission(Notification.permission);
      navigator.serviceWorker.ready
        .then(async (registration) => {
          swRegistrationRef.current = registration;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            setIsSubscribed(true);
          }
        })
        .catch(() => {
// ignore
        });
    }
  }, []);

  const requestPermission = async (): Promise<boolean> => {
    if (!isSupported) return false;
    if (permission === 'granted') return true;
    if (permission === 'denied') return false;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch {
      return false;
    }
  };

  const getVapidPublicKey = async (): Promise<string> => {
    const response = await fetch(`${API_BASE}/vapid-public-key`);
    if (!response.ok) throw new Error('Failed to fetch VAPID public key');
    const data = await response.json();
    return data.publicKey;
  };

  const subscribe = async (): Promise<void> => {
    if (!isSupported || !swRegistrationRef.current) return;
    const granted = await requestPermission();
    if (!granted) return;

    setError(null);
    setIsLoading(true);
    try {
      const publicKey = await getVapidPublicKey();
      const subscription = await swRegistrationRef.current.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON() as PushSubscriptionJson;
      const userId = getCurrentUserId();
      await fetch(`${API_BASE}/push-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...json, userId }),
      });

      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to subscribe to push notifications');
    } finally {
      setIsLoading(false);
    }
  };

  const unsubscribe = async (): Promise<void> => {
    if (!swRegistrationRef.current) return;
    setError(null);
    setIsLoading(true);
    try {
      const subscription = await swRegistrationRef.current.pushManager.getSubscription();
      if (subscription) {
        await fetch(`${API_BASE}/push-subscription`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unsubscribe from push notifications');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    enable: subscribe,
    disable: unsubscribe,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAti(i);
  }
  return outputArray;
}

function getCurrentUserId(): string | undefined {
  try {
    const stored = localStorage.getItem('stellarPublicKey');
    if (stored) return stored;
  } catch {
// ignore
  }
  return undefined;
}
