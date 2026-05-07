"use client";

import { useState, useEffect } from "react";
import { useSafeStatus } from "./useSafeStatus";

/**
 * Determines whether a page should show a loading indicator vs "no data".
 *
 * @param hasData - whether the page's primary query returned any data
 * @param isLoading - the `isLoading` flag from `useQuery()` — true until
 *                    the first set of results is available
 */
export function useSyncReady(hasData: boolean, isLoading: boolean) {
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

  // Data arrived → render it
  if (hasData) {
    return { showLoading: false, showEmpty: false, showConnectionError: false };
  }

  // Query still loading its first results
  if (isLoading) {
    return { showLoading: true, showEmpty: false, showConnectionError: false };
  }

  // Query returned empty and sync has completed
  if (syncStatus.hasSynced) {
    // Sync may have reset: downloading but no data yet.
    // Show loading for 30s, then connection error.
    // The `downloading` guard ensures this doesn't trigger when
    // the sync is healthy and the table is genuinely empty —
    // in that case downloading resolves quickly to false.
    if (downloading && !staleSyncTimedOut) {
      return { showLoading: true, showEmpty: false, showConnectionError: false };
    }
    if (downloading && staleSyncTimedOut) {
      return { showLoading: false, showEmpty: false, showConnectionError: true };
    }
    return { showLoading: false, showEmpty: true, showConnectionError: false };
  }

  // Query returned empty, sync hasn't completed, timeout elapsed
  if (timedOut) {
    return { showLoading: false, showEmpty: false, showConnectionError: true };
  }

  // Query returned empty, sync still in progress
  return { showLoading: true, showEmpty: false, showConnectionError: false };
}
