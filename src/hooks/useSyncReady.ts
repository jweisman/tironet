"use client";

import { useState, useEffect, useRef } from "react";
import { useSafeStatus } from "./useSafeStatus";
import { recordConnectionError } from "@/lib/support/last-connection-error";

/**
 * Determines whether a page should show a loading indicator vs "no data".
 *
 * @param hasData - whether the page's primary query returned any data
 * @param isLoading - the `isLoading` flag from `useQuery()` — true until
 *                    the first set of results is available
 * @param context - optional metadata captured into the diagnostic snapshot
 *                  when the connection-error state fires (e.g. selectedCycleId,
 *                  sessionStatus). Read by the support page's collectDiagnostics.
 */
export function useSyncReady(
  hasData: boolean,
  isLoading: boolean,
  context?: Record<string, unknown>,
) {
  const syncStatus = useSafeStatus();
  const downloading = syncStatus.dataFlowStatus?.downloading ?? false;

  // Fallback timeout: if hasSynced never becomes true AND the query
  // has finished loading with no data (fully offline, no cached data),
  // stop showing the spinner after 15 seconds.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (syncStatus.hasSynced || hasData) return;
    const t = setTimeout(() => setTimedOut(true), 15_000);
    return () => clearTimeout(t);
  }, [syncStatus.hasSynced, hasData]);

  // Stale sync detection: hasSynced may persist from a previous sync
  // generation. If the sync reset (config change, new claims) on a slow
  // network, the new data hasn't arrived yet. When hasSynced is true,
  // downloading is true, but there's no data, show loading for 30s then
  // connection error. On a healthy network this resolves quickly
  // (downloading goes false once the sync completes), so the `downloading`
  // guard in the return logic prevents false positives.
  const [staleSyncTimedOut, setStaleSyncTimedOut] = useState(false);
  useEffect(() => {
    if (hasData || !syncStatus.hasSynced || !downloading) return;
    const t = setTimeout(() => setStaleSyncTimedOut(true), 30_000);
    return () => clearTimeout(t);
  }, [hasData, syncStatus.hasSynced, downloading]);

  // Decide what to render
  let result: { showLoading: boolean; showEmpty: boolean; showConnectionError: boolean };
  let trigger: "stale-sync" | "first-sync-timeout" | null = null;

  if (hasData) {
    result = { showLoading: false, showEmpty: false, showConnectionError: false };
  } else if (isLoading) {
    result = { showLoading: true, showEmpty: false, showConnectionError: false };
  } else if (syncStatus.hasSynced) {
    if (downloading && !staleSyncTimedOut) {
      result = { showLoading: true, showEmpty: false, showConnectionError: false };
    } else if (downloading && staleSyncTimedOut) {
      result = { showLoading: false, showEmpty: false, showConnectionError: true };
      trigger = "stale-sync";
    } else {
      result = { showLoading: false, showEmpty: true, showConnectionError: false };
    }
  } else if (timedOut) {
    result = { showLoading: false, showEmpty: false, showConnectionError: true };
    trigger = "first-sync-timeout";
  } else {
    result = { showLoading: true, showEmpty: false, showConnectionError: false };
  }

  // Record a diagnostic snapshot the first time the connection-error state
  // fires. The snapshot persists to localStorage so the user can navigate
  // to /support and submit a report that includes the state at error time.
  // We capture only on the rising edge (false → true) to avoid overwriting
  // earlier snapshots if the same state churns.
  const recordedRef = useRef(false);
  useEffect(() => {
    if (!result.showConnectionError) {
      recordedRef.current = false;
      return;
    }
    if (recordedRef.current) return;
    if (typeof window === "undefined" || !trigger) return;
    recordedRef.current = true;
    recordConnectionError({
      at: new Date().toISOString(),
      page: window.location.pathname,
      trigger,
      online: navigator.onLine,
      hasSynced: syncStatus.hasSynced ?? false,
      downloading,
      hasData,
      context,
    });
    // context, hasSynced, downloading, hasData intentionally excluded from
    // deps — we capture the snapshot at the moment the error first fires,
    // not on later renders with newer state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.showConnectionError, trigger]);

  return result;
}
