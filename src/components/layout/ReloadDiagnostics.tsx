"use client";

import { useEffect } from "react";

/**
 * Temporary diagnostic component to identify what's causing automatic
 * page reloads on iOS Safari. Remove once the issue is resolved.
 *
 * Logs to console and persists to localStorage so entries survive
 * across process kills (sessionStorage is lost on process death).
 */
export function ReloadDiagnostics() {
  useEffect(() => {
    const STORAGE_KEY = "__diag";
    const HEARTBEAT_KEY = "__diag_hb";
    const MAX_LOG_SIZE = 8000; // Prevent storage bloat

    const log = (msg: string) => {
      const ts = new Date().toISOString().slice(11, 23);
      const entry = `[DIAG ${ts}] ${msg}`;
      console.warn(entry);
      try {
        let prev = localStorage.getItem(STORAGE_KEY) ?? "";
        // Trim old entries if too large
        if (prev.length > MAX_LOG_SIZE) {
          prev = prev.slice(-MAX_LOG_SIZE / 2);
        }
        localStorage.setItem(STORAGE_KEY, prev + entry + "\n");
      } catch { /* quota */ }
    };

    // Log navigation type on load
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      log(`page loaded, type=${navEntries[0].type}, url=${location.href}`);
    }

    // Check for previous crash evidence: compare last heartbeat to now
    try {
      const lastHB = localStorage.getItem(HEARTBEAT_KEY);
      if (lastHB) {
        const gap = Date.now() - parseInt(lastHB, 10);
        log(`last heartbeat was ${(gap / 1000).toFixed(1)}s ago (gap > 15s = likely process kill)`);
      }
      const prev = localStorage.getItem(STORAGE_KEY);
      if (prev) {
        console.warn("[DIAG] === previous entries ===\n" + prev);
      }
    } catch { /* */ }

    // Periodic heartbeat — lets us detect when the process died
    const heartbeatInterval = setInterval(() => {
      try {
        localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
      } catch { /* */ }
    }, 5000);

    // Detect beforeunload (page about to unload/reload)
    const onBeforeUnload = () => {
      log("beforeunload fired — page is about to reload/navigate");
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // Detect visibility changes (iOS backgrounding)
    const onVisibilityChange = () => {
      log(`visibilitychange: ${document.visibilityState}`);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Detect SW controller change (new SW took over)
    const onControllerChange = () => {
      log("controllerchange — new service worker took control");
    };
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);

    // Detect unhandled errors
    const onError = (e: ErrorEvent) => {
      log(`unhandled error: ${e.message} at ${e.filename}:${e.lineno}`);
    };
    window.addEventListener("error", onError);

    // Detect unhandled promise rejections
    const onRejection = (e: PromiseRejectionEvent) => {
      log(`unhandled rejection: ${e.reason}`);
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
