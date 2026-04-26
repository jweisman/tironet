import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Returns a function that navigates back if the user came from within
 * the app, or falls back to the given path (e.g. "/requests").
 * Handles direct navigation (e.g. from a push notification link)
 * where there is no in-app history to go back to.
 */
export function useGoBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    let hasAppHistory = false;
    try {
      const referrer = typeof document !== "undefined" ? document.referrer : "";
      if (referrer) {
        const url = new URL(referrer);
        hasAppHistory = url.origin === window.location.origin && !url.pathname.startsWith("/serwist");
      }
    } catch { /* invalid referrer URL */ }
    if (hasAppHistory) {
      router.back();
    } else {
      window.location.assign(fallback);
    }
  }, [router, fallback]);
}
