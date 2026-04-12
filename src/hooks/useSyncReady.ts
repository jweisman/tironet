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

  // Fallback timeout: if hasSynced never becomes true AND the query
  // has finished loading with no data (fully offline, no cached data),
  // stop showing the spinner after 15 seconds.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (syncStatus.hasSynced || hasData) return;
    const t = setTimeout(() => setTimedOut(true), 15_000);
    return () => clearTimeout(t);
  }, [syncStatus.hasSynced, hasData]);

  // Data arrived → render it
  if (hasData) {
    return { showLoading: false, showEmpty: false, showConnectionError: false };
  }

  // Query still loading its first results
  if (isLoading) {
    return { showLoading: true, showEmpty: false, showConnectionError: false };
  }

  // Query returned empty and sync has completed → genuinely no data
  if (syncStatus.hasSynced) {
    return { showLoading: false, showEmpty: true, showConnectionError: false };
  }

  // Query returned empty, sync hasn't completed, timeout elapsed
  if (timedOut) {
    return { showLoading: false, showEmpty: false, showConnectionError: true };
  }

  // Query returned empty, sync still in progress
  return { showLoading: true, showEmpty: false, showConnectionError: false };
}
