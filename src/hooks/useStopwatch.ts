"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type StopwatchState,
  clearLaps as clearLapsState,
  clearState as clearStorage,
  createInitialState,
  loadFreshState,
  pause as pauseState,
  recordLap as recordLapState,
  removeLap as removeLapState,
  saveState,
  start as startState,
} from "@/lib/stopwatch/state";

interface UseStopwatchOptions {
  activityId: string;
  scoreKey: string;
  /** When false, suspends the rAF tick (e.g. dialog closed). Defaults to true. */
  active?: boolean;
}

/**
 * React wrapper around the pure stopwatch state module.
 *
 * Restores from localStorage on mount and writes back on every state change.
 * While `active` is true and the timer is running, drives a ~30 Hz tick
 * (via requestAnimationFrame) so the displayed elapsed time updates smoothly.
 */
export function useStopwatch({ activityId, scoreKey, active = true }: UseStopwatchOptions) {
  // Lazy init reads from localStorage — only runs on first render. The hook
  // is only mounted client-side (inside an opened dialog), so window/localStorage
  // are always available here. `loadFreshState` discards persisted state that
  // looks terminal (all laps assigned, timer stopped) or stale-running
  // (timer claims to be running for an unrealistically long time), so the
  // user sees a clean stopwatch when they reopen after a completed session.
  const [state, setState] = useState<StopwatchState>(
    () =>
      loadFreshState(activityId, scoreKey, Date.now()) ??
      createInitialState(activityId, scoreKey),
  );
  const [now, setNow] = useState(() => Date.now());

  // Persist on every state change.
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Drive the `now` clock for elapsed-time rendering. While running, chain
  // requestAnimationFrame to keep ~60fps updates. When paused, we still tick
  // once so reopening after a long idle doesn't briefly show a stale elapsed.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setNow(Date.now());
      if (state.running) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, state.running]);

  const start = useCallback(() => {
    setState((s) => startState(s, Date.now()));
    setNow(Date.now());
  }, []);

  const pause = useCallback(() => {
    setState((s) => pauseState(s, Date.now()));
  }, []);

  const lap = useCallback(() => {
    setState((s) => recordLapState(s, Date.now(), crypto.randomUUID()));
  }, []);

  const clearLaps = useCallback(() => {
    setState((s) => clearLapsState(s));
  }, []);

  const removeLap = useCallback((lapId: string) => {
    setState((s) => removeLapState(s, lapId));
  }, []);

  /** Wipe everything for this (activityId, scoreKey) including the timer. */
  const reset = useCallback(() => {
    clearStorage(activityId, scoreKey);
    setState(createInitialState(activityId, scoreKey));
  }, [activityId, scoreKey]);

  return {
    state,
    now,
    start,
    pause,
    lap,
    clearLaps,
    removeLap,
    reset,
  };
}
