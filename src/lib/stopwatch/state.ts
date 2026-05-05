/**
 * Pure state utilities for the activity stopwatch.
 *
 * The stopwatch records lap times against a specific (activityId, scoreKey)
 * pair. State is persisted in localStorage so the timer survives the dialog
 * being closed, the page being refreshed, or the app being killed.
 *
 * `startedAt` is set to `Date.now()` when the timer is running and cleared
 * when paused. While running, total elapsed = accumulatedMs + (now - startedAt).
 */

export interface Lap {
  id: string;
  number: number;
  elapsedMs: number;
}

export interface StopwatchState {
  activityId: string;
  scoreKey: string;
  startedAt: number | null;
  accumulatedMs: number;
  running: boolean;
  laps: Lap[];
  nextLapNumber: number;
}

export function createInitialState(activityId: string, scoreKey: string): StopwatchState {
  return {
    activityId,
    scoreKey,
    startedAt: null,
    accumulatedMs: 0,
    running: false,
    laps: [],
    nextLapNumber: 1,
  };
}

/** Total elapsed milliseconds at `now`. */
export function elapsedMs(state: StopwatchState, now: number): number {
  if (state.running && state.startedAt != null) {
    return state.accumulatedMs + (now - state.startedAt);
  }
  return state.accumulatedMs;
}

export function start(state: StopwatchState, now: number): StopwatchState {
  if (state.running) return state;
  return { ...state, running: true, startedAt: now };
}

export function pause(state: StopwatchState, now: number): StopwatchState {
  if (!state.running) return state;
  const total = elapsedMs(state, now);
  return { ...state, running: false, startedAt: null, accumulatedMs: total };
}

export function recordLap(state: StopwatchState, now: number, id: string): StopwatchState {
  if (!state.running) return state;
  const lap: Lap = {
    id,
    number: state.nextLapNumber,
    elapsedMs: elapsedMs(state, now),
  };
  return {
    ...state,
    // Newest first.
    laps: [lap, ...state.laps],
    nextLapNumber: state.nextLapNumber + 1,
  };
}

export function removeLap(state: StopwatchState, lapId: string): StopwatchState {
  return { ...state, laps: state.laps.filter((l) => l.id !== lapId) };
}

/** Clear all laps and the running counter, but preserve the timer's elapsed state. */
export function clearLaps(state: StopwatchState): StopwatchState {
  return { ...state, laps: [], nextLapNumber: 1 };
}

/**
 * Format milliseconds as MM:SS.cc (centiseconds).
 * MM is at least two digits but may grow beyond 99 for very long runs.
 */
export function formatStopwatch(totalMs: number): string {
  const safe = Math.max(0, totalMs);
  const totalCs = Math.floor(safe / 10);
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(cs)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Round elapsed milliseconds to whole seconds for storage in the report grade.
 * Uses standard rounding so 1499 → 1s, 1500 → 2s.
 */
export function roundToSeconds(elapsedMillis: number): number {
  return Math.round(elapsedMillis / 1000);
}

// ---------------------------------------------------------------------------
// State-validity heuristics
// ---------------------------------------------------------------------------

/**
 * Cutoff for treating a "running" timer found in localStorage as forgotten.
 * Any single recorded session is expected to fit comfortably under this
 * window; longer means the user almost certainly closed the dialog with
 * the timer still running and never came back.
 */
export const STALE_RUNNING_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * "Terminal" — the user recorded laps in some past session, all of them
 * have been assigned (or deleted), and the timer isn't running. This is
 * the unambiguous "session is over" signal we use to auto-reset on reopen.
 *
 * `nextLapNumber > 1` is the proof that laps existed at some point —
 * without it we'd reset every fresh-empty initial state on every open.
 */
export function isTerminalState(state: StopwatchState): boolean {
  return state.laps.length === 0 && state.nextLapNumber > 1 && !state.running;
}

/**
 * "Stale running" — state says the timer is running but `startedAt` is far
 * enough in the past that we treat it as a forgotten timer rather than a
 * legitimate long session.
 */
export function isStaleRunningState(
  state: StopwatchState,
  now: number,
  thresholdMs: number = STALE_RUNNING_THRESHOLD_MS,
): boolean {
  if (!state.running || state.startedAt == null) return false;
  return now - state.startedAt > thresholdMs;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "tironet:stopwatch:";

export function storageKey(activityId: string, scoreKey: string): string {
  return `${STORAGE_PREFIX}${activityId}:${scoreKey}`;
}

export function loadState(activityId: string, scoreKey: string): StopwatchState | null {
  try {
    const raw = localStorage.getItem(storageKey(activityId, scoreKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StopwatchState>;
    if (parsed.activityId !== activityId || parsed.scoreKey !== scoreKey) return null;
    if (!Array.isArray(parsed.laps)) return null;
    return {
      activityId,
      scoreKey,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
      accumulatedMs: typeof parsed.accumulatedMs === "number" ? parsed.accumulatedMs : 0,
      running: Boolean(parsed.running),
      laps: parsed.laps as Lap[],
      nextLapNumber: typeof parsed.nextLapNumber === "number" ? parsed.nextLapNumber : 1,
    };
  } catch {
    return null;
  }
}

/**
 * Load and validate state for an open of the stopwatch. If the saved state
 * is terminal or stale-running, wipe it and return null so the caller falls
 * through to a fresh initial state. Otherwise return the loaded state.
 */
export function loadFreshState(
  activityId: string,
  scoreKey: string,
  now: number,
): StopwatchState | null {
  const loaded = loadState(activityId, scoreKey);
  if (!loaded) return null;
  if (isTerminalState(loaded) || isStaleRunningState(loaded, now)) {
    clearState(activityId, scoreKey);
    return null;
  }
  return loaded;
}

export function saveState(state: StopwatchState): void {
  try {
    localStorage.setItem(storageKey(state.activityId, state.scoreKey), JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (Safari Private Browsing, quota exceeded)
  }
}

export function clearState(activityId: string, scoreKey: string): void {
  try {
    localStorage.removeItem(storageKey(activityId, scoreKey));
  } catch {
    // ignore
  }
}
