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
    const hasAppHistory =
      typeof document !== "undefined" &&
      document.referrer &&
      new URL(document.referrer).origin === window.location.origin;
    if (hasAppHistory) {
      router.back();
    } else {
      router.push(fallback);
    }
  }, [router, fallback]);
}
