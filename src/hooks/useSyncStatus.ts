"use client";

import { useState, useEffect, useRef } from "react";
import { useSafeStatus } from "./useSafeStatus";

export type SyncState = "initializing" | "synced" | "syncing" | "stale" | "error";

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
 *   - 5s grace on mount before transitioning out of initializing
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

  // Grace period: suppress non-grey states for 5s after mount
  // to let PowerSync establish its WebSocket connection.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  // Debounce connected → disconnected transitions by 2s
  // to avoid brief yellow flashes during WebSocket reconnects.
  const [debouncedConnected, setDebouncedConnected] = useState(connected);
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected) {
      // Connected immediately
      setDebouncedConnected(true);
      prevConnected.current = true;
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
    setDebouncedConnected(false);
    prevConnected.current = false;
  }, [connected]);

  // Only treat corruption as a true error (red). Connection failures
  // are expected when the server is unreachable — those are "stale" (yellow).
  const isCorrupt = downloadError
    && (downloadError instanceof Error ? downloadError.message : String(downloadError))
      .includes("CORRUPT");

  // Compute state
  let state: SyncState;

  if (isCorrupt) {
    state = "error";
  } else if (!graceOver && !connected) {
    // During the grace period, if PowerSync hasn't connected yet,
    // show initializing (grey) or synced (green) based on cached data —
    // never yellow/stale during startup while the WebSocket is establishing.
    // Once connected, skip the grace and show the real state immediately.
    state = hasSynced ? "synced" : "initializing";
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
