"use client";

import { useEffect, useRef } from "react";

const STORAGE_PREFIX = "tironet:perf:";

interface PerfEntry {
  mountAt: number;
  dataReadyAt: number | null;
  mountToReadyMs: number | null;
  loggedAt: number;
}

/**
 * Records page lifecycle timing to sessionStorage so the support diagnostic
 * can surface "time from page mount to data ready". Records the most recent
 * visit per pageId — overwrites prior visits.
 *
 * `dataReady` should be `true` once the page has the data it needs to render
 * its primary content (e.g. a list page's main query has resolved with rows).
 *
 * Marks are also pushed to performance.mark() for DevTools timeline use.
 */
export function usePagePerf(pageId: string, dataReady: boolean): void {
  const mountAtRef = useRef<number | null>(null);
  const recordedReadyRef = useRef(false);

  if (mountAtRef.current === null) {
    mountAtRef.current = performance.now();
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mountAt = mountAtRef.current ?? performance.now();
    try {
      performance.mark(`${pageId}:mount`);
    } catch {}
    const entry: PerfEntry = {
      mountAt,
      dataReadyAt: null,
      mountToReadyMs: null,
      loggedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(STORAGE_PREFIX + pageId, JSON.stringify(entry));
    } catch {}
    recordedReadyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => {
    if (!dataReady || recordedReadyRef.current) return;
    recordedReadyRef.current = true;
    const dataReadyAt = performance.now();
    const mountAt = mountAtRef.current ?? dataReadyAt;
    try {
      performance.mark(`${pageId}:data-ready`);
    } catch {}
    const entry: PerfEntry = {
      mountAt,
      dataReadyAt,
      mountToReadyMs: Math.round(dataReadyAt - mountAt),
      loggedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(STORAGE_PREFIX + pageId, JSON.stringify(entry));
    } catch {}
  }, [dataReady, pageId]);
}

/** Read the most-recent perf entry for a page; null if never recorded. */
export function readPagePerf(pageId: string): PerfEntry | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + pageId);
    if (!raw) return null;
    return JSON.parse(raw) as PerfEntry;
  } catch {
    return null;
  }
}
