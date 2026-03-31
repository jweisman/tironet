"use client";

import { useState, useEffect, useCallback } from "react";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

interface PushSubscriptionState {
  /** Browser permission state, or "unsupported" if push is unavailable */
  permission: PermissionState;
  /** Whether the user currently has an active push subscription */
  isSubscribed: boolean;
  /** Subscribe to push notifications (requests permission if needed) */
  subscribe: () => Promise<boolean>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<void>;
  /** True while a subscribe/unsubscribe operation is in progress */
  loading: boolean;
  /** True if running on iOS and the PWA is NOT installed to Home Screen */
  iosRequiresInstall: boolean;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Detect iOS Safari that is NOT running as a standalone PWA.
 * Push notifications on iOS only work when installed to Home Screen.
 */
function getIosRequiresInstall(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  // standalone = true when launched from Home Screen
  const isStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !isStandalone;
}

export function usePushSubscription(): PushSubscriptionState {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [iosRequiresInstall] = useState(() => getIosRequiresInstall());

  // Check current state on mount
  useEffect(() => {
    if (!isPushSupported()) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission as PermissionState);

    // Check if already subscribed
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setIsSubscribed(sub !== null))
      .catch(() => {});
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported()) return false;

    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") return false;

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.error("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set");
        return false;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      // Send subscription to server
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });

      if (!res.ok) {
        console.error("[push] subscribe API failed:", res.status);
        return false;
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Tell server to remove the subscription
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error("[push] unsubscribe failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { permission, isSubscribed, subscribe, unsubscribe, loading, iosRequiresInstall };
}

/**
 * Convert a base64url-encoded VAPID public key to a Uint8Array
 * for use with PushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
