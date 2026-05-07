"use client";

import { useRef, useEffect } from "react";
import { useQuery } from "@powersync/react";

const STORAGE_PREFIX = "tironet:perf:query:";

interface TrackedEntry {
  /** ms from hook mount to first data emission with rows. */
  firstDataMs: number | null;
  /** ms from hook mount to most recent data emission with rows. */
  lastDataMs: number | null;
  /** Number of times `data` was emitted as a non-empty array. */
  dataEmits: number;
  /** Number of times `isFetching` toggled true (re-evaluation). */
  fetchTransitions: number;
  /** Last observed row count. */
  rowCount: number;
  /** When this entry was last updated. */
  loggedAt: number;
}

/**
 * Wrapper around PowerSync's `useQuery` that records per-query lifecycle stats
 * to sessionStorage. Use only on pages we're actively diagnosing — adds an
 * effect call per query.
 *
 * `label` should be unique per call site (e.g. `"soldiers.SOLDIERS"`).
 */
export function useTrackedQuery<RowType = unknown>(
  label: string,
  sql: string,
  params: unknown[],
): { data: RowType[] | undefined; isLoading: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery<any>(sql, params);
  const mountAtRef = useRef<number | null>(null);
  const stateRef = useRef<TrackedEntry>({
    firstDataMs: null,
    lastDataMs: null,
    dataEmits: 0,
    fetchTransitions: 0,
    rowCount: 0,
    loggedAt: Date.now(),
  });
  const prevFetchingRef = useRef<boolean>(true);
  const prevDataLenRef = useRef<number>(-1);

  if (mountAtRef.current === null) {
    mountAtRef.current = performance.now();
    try {
      sessionStorage.setItem(STORAGE_PREFIX + label, JSON.stringify(stateRef.current));
    } catch {}
  }

  // isFetching transitions: count edges from false → true after the initial load.
  const isFetching = (result as unknown as { isFetching?: boolean }).isFetching ?? false;
  if (!prevFetchingRef.current && isFetching) {
    stateRef.current.fetchTransitions++;
  }
  prevFetchingRef.current = isFetching;

  useEffect(() => {
    // Record on every transition out of the initial unresolved state — including
    // empty-result resolutions. Without this, queries that legitimately return
    // 0 rows look like "never resolved" in diagnostics.
    if (result.isLoading) return;
    const len = (result.data ?? []).length;
    if (len === prevDataLenRef.current) return;
    const now = performance.now();
    const mountAt = mountAtRef.current ?? now;
    stateRef.current.dataEmits++;
    stateRef.current.lastDataMs = Math.round(now - mountAt);
    stateRef.current.rowCount = len;
    if (stateRef.current.firstDataMs === null) {
      stateRef.current.firstDataMs = stateRef.current.lastDataMs;
    }
    stateRef.current.loggedAt = Date.now();
    try {
      sessionStorage.setItem(STORAGE_PREFIX + label, JSON.stringify(stateRef.current));
    } catch {}
    prevDataLenRef.current = len;
  }, [result.data, result.isLoading, label]);

  return { data: result.data, isLoading: result.isLoading };
}

/** Read all tracked-query entries and return as a flat label→summary map. */
export function readTrackedQueries(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      const raw = sessionStorage.getItem(k);
      if (!raw) continue;
      try {
        const e = JSON.parse(raw) as TrackedEntry;
        const label = k.slice(STORAGE_PREFIX.length);
        const ago = Math.round((Date.now() - e.loggedAt) / 1000);
        out[label] =
          `firstData=${e.firstDataMs ?? "—"}ms` +
          ` lastData=${e.lastDataMs ?? "—"}ms` +
          ` emits=${e.dataEmits}` +
          ` fetches=${e.fetchTransitions}` +
          ` rows=${e.rowCount}` +
          ` (${ago}s ago)`;
      } catch {}
    }
  } catch {}
  return out;
}
