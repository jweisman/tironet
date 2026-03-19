"use client";

import { useEffect, type ReactNode } from "react";

export function SerwistProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "development" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/serwist/sw.js")
      .catch((err) => console.error("[SW] registration failed:", err));

    // Intentionally NO controllerchange listener. The default SerwistProvider
    // reloads the page when a new SW takes control (via skipWaiting +
    // clientsClaim). On iOS, that reload + any RSC error recovery reload =
    // two rapid reloads = "A problem repeatedly occurred" crash.
    // Instead, the new SW silently takes over; the next user navigation
    // will use the new SW's cached content.
  }, []);

  return <>{children}</>;
}
