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
      .register("/serwist/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[SW] registered, scope:", reg.scope);

        // Ask the SW to warm its shell cache. Next.js Link navigations use RSC
        // payloads (mode: "cors"), so the SW never intercepts them as navigations
        // and never gets a chance to cache the HTML shell. This message triggers
        // the SW to fetch and cache shells for all route families while we have
        // auth cookies available.
        //
        // Only send WARM_SHELLS after successful registration — if registration
        // failed there is no controller to receive it.
        navigator.serviceWorker.ready.then(() => {
          navigator.serviceWorker.controller?.postMessage({ type: "WARM_SHELLS" });
        });
      })
      .catch((err) => {
        console.error("[SW] registration failed — offline mode unavailable:", err);
      });

    // Intentionally NO controllerchange listener. The default SerwistProvider
    // reloads the page when a new SW takes control (via skipWaiting +
    // clientsClaim). On iOS, that reload + any RSC error recovery reload =
    // two rapid reloads = "A problem repeatedly occurred" crash.
    // Instead, the new SW silently takes over; the next user navigation
    // will use the new SW's cached content.
  }, []);

  return <>{children}</>;
}
