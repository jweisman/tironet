"use client";

import { useEffect } from "react";

/**
 * Temporary diagnostic component to identify what's causing automatic
 * page reloads on iOS Safari. Remove once the issue is resolved.
 *
 * Logs to console and persists to sessionStorage so entries survive
 * across reloads and can be read after a crash.
 */
export function ReloadDiagnostics() {
  useEffect(() => {
    const log = (msg: string) => {
      const ts = new Date().toISOString().slice(11, 23);
      const entry = `[DIAG ${ts}] ${msg}`;
      console.warn(entry);
      // Persist to sessionStorage so we can read it after reload/crash
      try {
        const prev = sessionStorage.getItem("__diag") ?? "";
        sessionStorage.setItem("__diag", prev + entry + "\n");
      } catch { /* quota */ }
    };

    // Log navigation type on load
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      log(`page loaded, type=${navEntries[0].type}, url=${location.href}`);
    }

    // Log previous diagnostics from before reload
    try {
      const prev = sessionStorage.getItem("__diag");
      if (prev) {
        console.warn("[DIAG] === previous session entries ===\n" + prev);
      }
    } catch { /* */ }

    // Detect beforeunload (page about to unload/reload)
    const onBeforeUnload = () => {
      log("beforeunload fired — page is about to reload/navigate");
    };
    window.addEventListener("beforeunload", onBeforeUnload);

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

    // Monkey-patch location.reload to capture call stack
    const origReload = location.reload.bind(location);
    Object.defineProperty(location, "reload", {
      value: () => {
        log(`location.reload() called! Stack: ${new Error().stack}`);
        origReload();
      },
      configurable: true,
    });

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
