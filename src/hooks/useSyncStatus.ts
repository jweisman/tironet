"use client";

import { useState, useEffect, useRef } from "react";
import { useSafeStatus } from "./useSafeStatus";

export type SyncState = "initializing" | "synced" | "syncing" | "stale" | "error";

// App-level grace period: shared across all useSyncStatus() instances so the
// toolbar dot and support page (which mount at different times) agree on state.
const APP_LOAD_TIME = typeof window !== "undefined" ? Date.now() : 0;
const GRACE_DURATION_MS = 10_000;

/**
 * Returns the current sync state for display as a status indicator.
 *
 * States:
 *   initializing (grey)  — first-ever sync, no data yet
 *   synced       (green) — connected, not downloading, recent checkpoint
 *   syncing      (blue)  — connected and actively downloading
 *   stale        (yellow)— device online but PowerSync not connected
 *   error        (red)   — CORRUPT downloadError (database corruption)
 *
 * Includes debouncing:
 *   - 10s grace from app load before transitioning out of initializing
 *   - 2s debounce on connected → stale to avoid flicker during reconnects
 */
export function useSyncStatus(): { state: SyncState; lastSyncedAt: Date | undefined } {
  const status = useSafeStatus();
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const connected = status.connected ?? false;
  const downloading = status.dataFlowStatus?.downloading ?? false;
  const downloadError = status.dataFlowStatus?.downloadError;
  const hasSynced = status.hasSynced ?? false;
  const lastSyncedAt = status.lastSyncedAt;

  // Grace period: shared across all instances via APP_LOAD_TIME so components
  // that mount later (e.g. support page) don't restart the grace window.
  const [graceOver, setGraceOver] = useState(() => {
    if (typeof window === "undefined") return false;
    return Date.now() - APP_LOAD_TIME >= GRACE_DURATION_MS;
  });
  useEffect(() => {
    if (graceOver) return;
    const remaining = GRACE_DURATION_MS - (Date.now() - APP_LOAD_TIME);
    // If already expired, the useState initializer should have caught it.
    // Use Math.max(1, ...) as a safety net to avoid a synchronous setState.
    const t = setTimeout(() => setGraceOver(true), Math.max(1, remaining));
    return () => clearTimeout(t);
  }, [graceOver]);

  // Debounce connected → disconnected transitions by 2s
  // to avoid brief yellow flashes during WebSocket reconnects.
  // Connected → true is immediate (via queueMicrotask to satisfy the lint rule);
  // connected → false is delayed by 2s.
  const [debouncedConnected, setDebouncedConnected] = useState(connected);
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected) {
      // Connected — update on next microtask to avoid synchronous setState in effect
      prevConnected.current = true;
      queueMicrotask(() => setDebouncedConnected(true));
      return;
    }
    if (prevConnected.current && !connected) {
      // Was connected, now disconnected — debounce
      const t = setTimeout(() => {
        setDebouncedConnected(false);
        prevConnected.current = false;
      }, 2_000);
      return () => clearTimeout(t);
    }
    // Was already disconnected
    prevConnected.current = false;
    queueMicrotask(() => setDebouncedConnected(false));
  }, [connected]);

  // Only treat corruption as a true error (red). Connection failures
  // are expected when the server is unreachable — those are "stale" (yellow).
  // downloadError may be a real Error or a plain object from the web worker
  // (Comlink can't transfer Error instances across the worker boundary).
  // Check .message first (works for both), fall back to String().
  const errorMessage = downloadError
    ? ((downloadError as { message?: string }).message ?? String(downloadError))
    : "";
  const isCorrupt = errorMessage.includes("CORRUPT")
    || errorMessage.includes("malformed");

  // Compute state
  let state: SyncState;

  if (isCorrupt) {
    state = "error";
  } else if (!graceOver && !connected) {
    // During the grace period, if PowerSync hasn't connected yet,
    // show initializing (grey) or synced (green) based on cached data —
    // never yellow/stale during startup while the WebSocket is establishing.
    // Once connected, skip the grace and show the real state immediately.
    // Only show "synced" if we have a lastSyncedAt timestamp — hasSynced
    // persists across sessions but lastSyncedAt is runtime-only, so without
    // this check we'd show "synced" with no sync timestamp on the support page.
    state = hasSynced && lastSyncedAt ? "synced" : "initializing";
  } else if (debouncedConnected && downloading) {
    state = "syncing";
  } else if (debouncedConnected && !downloading) {
    state = "synced";
  } else if (!debouncedConnected && online) {
    state = "stale";
  } else if (!debouncedConnected && !online) {
    // Offline — the offline banner handles this, show stale for the dot
    state = "stale";
  } else {
    state = "initializing";
  }

  return { state, lastSyncedAt };
}
