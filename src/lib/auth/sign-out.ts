import { signOut } from "next-auth/react";

/**
 * Sign out and clear service worker caches so no sensitive data persists
 * on shared devices after logout.
 */
export function signOutAndClearCaches() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CACHES" });
  }
  signOut({ callbackUrl: "/" });
}
