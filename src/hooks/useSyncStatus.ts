"use client";

import { useEffect, useRef, useState } from "react";
import { useSafeStatus } from "./useSafeStatus";

export type SyncState = "initializing" | "synced" | "syncing" | "stale" | "error";

/**
 * Returns the current sync state for display as a status indicator.
 *
 * States:
 *   initializing (grey)  — haven't connected to PowerSync yet this session
 *   synced       (green) — connected, not downloading
 *   syncing      (blue)  — connected and actively downloading
 *   stale        (yellow)— was connected this session, now disconnected
 *   error        (red)   — CORRUPT downloadError (database corruption)
 *
 * Before the first successful connection this session, the state is always
 * "initializing" (grey). No grace period or timer — just a simple signal.
 * After the first connection, disconnects are debounced by 2s to avoid
 * brief yellow flashes during WebSocket reconnects.
 */
export function useSyncStatus(): { state: SyncState; lastSyncedAt: Date | undefined; errorMessage: string | null } {
  const status = useSafeStatus();
  const connected = status.connected ?? false;
  const downloading = status.dataFlowStatus?.downloading ?? false;
  const downloadError = status.dataFlowStatus?.downloadError;
  const lastSyncedAt = status.lastSyncedAt;

  // Track whether PowerSync has connected at least once this session.
  // Derived from `connected` via useState initializer + lazy update so
  // the value is available during render (refs can't be read during render
  // per React Compiler rules) and without setState-in-effect lint issues.
  const [hasConnectedThisSession, setHasConnectedThisSession] = useState(connected);
  if (connected && !hasConnectedThisSession) {
    setHasConnectedThisSession(true);
  }

  // Debounce connected → disconnected transitions by 2s
  // to avoid brief yellow flashes during WebSocket reconnects.
  // Only active after the first connection — before that, always grey.
  const [debouncedConnected, setDebouncedConnected] = useState(connected);
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected) {
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
  } else if (!hasConnectedThisSession) {
    // Haven't connected yet this session — grey until first connection.
    state = "initializing";
  } else if (debouncedConnected && downloading) {
    state = "syncing";
  } else if (debouncedConnected && !downloading) {
    state = "synced";
  } else if (!debouncedConnected) {
    // Was connected, now disconnected (online or offline) — stale
    state = "stale";
  } else {
    state = "initializing";
  }

  return { state, lastSyncedAt, errorMessage: errorMessage || null };
}
