import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  STALE_RUNNING_THRESHOLD_MS,
  clearLaps,
  clearState,
  createInitialState,
  elapsedMs,
  formatStopwatch,
  isStaleRunningState,
  isTerminalState,
  loadFreshState,
  loadState,
  pause,
  recordLap,
  removeLap,
  roundToSeconds,
  saveState,
  start,
  storageKey,
} from "../state";

describe("formatStopwatch", () => {
  it("formats milliseconds as MM:SS.cc", () => {
    expect(formatStopwatch(0)).toBe("00:00.00");
    expect(formatStopwatch(10)).toBe("00:00.01");
    expect(formatStopwatch(990)).toBe("00:00.99");
    expect(formatStopwatch(1_000)).toBe("00:01.00");
    expect(formatStopwatch(60_000)).toBe("01:00.00");
    expect(formatStopwatch(3 * 60_000 + 21 * 1_000 + 70)).toBe("03:21.07");
  });

  it("clamps negative values to zero", () => {
    expect(formatStopwatch(-100)).toBe("00:00.00");
  });

  it("supports times beyond 99 minutes", () => {
    expect(formatStopwatch(100 * 60_000)).toBe("100:00.00");
  });

  it("truncates sub-centisecond fractions (does not round up)", () => {
    // 999ms = 99cs. Going from 999 to 1009 changes display from 00.99 to 01.00.
    expect(formatStopwatch(999)).toBe("00:00.99");
    expect(formatStopwatch(1_009)).toBe("00:01.00");
  });
});

describe("roundToSeconds", () => {
  it("rounds millisecond elapsed to whole seconds", () => {
    expect(roundToSeconds(0)).toBe(0);
    expect(roundToSeconds(499)).toBe(0);
    expect(roundToSeconds(500)).toBe(1);
    expect(roundToSeconds(1_499)).toBe(1);
    expect(roundToSeconds(1_500)).toBe(2);
    expect(roundToSeconds(195_260)).toBe(195);
  });
});

describe("stopwatch state machine", () => {
  it("creates an empty initial state", () => {
    const s = createInitialState("act1", "score1");
    expect(s.activityId).toBe("act1");
    expect(s.scoreKey).toBe("score1");
    expect(s.running).toBe(false);
    expect(s.startedAt).toBeNull();
    expect(s.accumulatedMs).toBe(0);
    expect(s.laps).toEqual([]);
    expect(s.nextLapNumber).toBe(1);
  });

  it("elapsedMs is 0 at rest", () => {
    expect(elapsedMs(createInitialState("a", "s"), 1_000)).toBe(0);
  });

  it("start sets running=true and stamps startedAt", () => {
    const s = start(createInitialState("a", "s"), 1_000);
    expect(s.running).toBe(true);
    expect(s.startedAt).toBe(1_000);
  });

  it("start is a no-op when already running", () => {
    const s1 = start(createInitialState("a", "s"), 1_000);
    const s2 = start(s1, 5_000);
    expect(s2).toBe(s1);
  });

  it("elapsedMs grows with time while running", () => {
    const s = start(createInitialState("a", "s"), 1_000);
    expect(elapsedMs(s, 1_000)).toBe(0);
    expect(elapsedMs(s, 1_500)).toBe(500);
    expect(elapsedMs(s, 4_321)).toBe(3_321);
  });

  it("pause freezes accumulatedMs and clears startedAt", () => {
    const running = start(createInitialState("a", "s"), 1_000);
    const paused = pause(running, 4_000);
    expect(paused.running).toBe(false);
    expect(paused.startedAt).toBeNull();
    expect(paused.accumulatedMs).toBe(3_000);
    expect(elapsedMs(paused, 99_999)).toBe(3_000);
  });

  it("pause is a no-op when not running", () => {
    const s = createInitialState("a", "s");
    expect(pause(s, 1_000)).toBe(s);
  });

  it("resume from pause accumulates additional time", () => {
    const s1 = start(createInitialState("a", "s"), 1_000);
    const s2 = pause(s1, 4_000); // accumulated = 3_000
    const s3 = start(s2, 10_000);
    expect(elapsedMs(s3, 12_500)).toBe(3_000 + 2_500);
  });

  it("recordLap captures elapsed and increments number", () => {
    const s1 = start(createInitialState("a", "s"), 1_000);
    const s2 = recordLap(s1, 4_000, "lap-a");
    expect(s2.laps).toEqual([{ id: "lap-a", number: 1, elapsedMs: 3_000 }]);
    expect(s2.nextLapNumber).toBe(2);

    const s3 = recordLap(s2, 7_000, "lap-b");
    // Newest first.
    expect(s3.laps.map((l) => l.number)).toEqual([2, 1]);
    expect(s3.laps[0].elapsedMs).toBe(6_000);
    expect(s3.nextLapNumber).toBe(3);
  });

  it("recordLap is a no-op when not running", () => {
    const s = createInitialState("a", "s");
    expect(recordLap(s, 1_000, "lap-a")).toBe(s);
  });

  it("removeLap drops a lap by id but keeps numbering stable", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = recordLap(s, 2_000, "b");
    s = recordLap(s, 3_000, "c");
    const after = removeLap(s, "b");
    expect(after.laps.map((l) => l.id)).toEqual(["c", "a"]);
    expect(after.laps.map((l) => l.number)).toEqual([3, 1]);
    // Counter does NOT regress when a lap is removed.
    expect(after.nextLapNumber).toBe(4);
  });

  it("clearLaps wipes laps and resets the counter but preserves timer", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = recordLap(s, 2_000, "b");
    s = pause(s, 5_000);
    const cleared = clearLaps(s);
    expect(cleared.laps).toEqual([]);
    expect(cleared.nextLapNumber).toBe(1);
    expect(cleared.accumulatedMs).toBe(5_000);
    expect(cleared.running).toBe(false);
  });
});

describe("localStorage persistence", () => {
  // Stub localStorage for the test environment.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
    } as Storage);
  });

  it("storageKey scopes by activity + score", () => {
    expect(storageKey("act1", "score1")).toBe("tironet:stopwatch:act1:score1");
    expect(storageKey("act1", "score2")).toBe("tironet:stopwatch:act1:score2");
  });

  it("save + load round-trips state", () => {
    let s = start(createInitialState("act1", "score1"), 1_000);
    s = recordLap(s, 4_000, "lap-a");
    s = pause(s, 5_000);
    saveState(s);

    const loaded = loadState("act1", "score1");
    expect(loaded).not.toBeNull();
    expect(loaded!.accumulatedMs).toBe(4_000);
    expect(loaded!.laps).toEqual([{ id: "lap-a", number: 1, elapsedMs: 3_000 }]);
    expect(loaded!.nextLapNumber).toBe(2);
    expect(loaded!.running).toBe(false);
  });

  it("loadState returns null when no value is stored", () => {
    expect(loadState("missing", "score1")).toBeNull();
  });

  it("rehydrated running state continues counting from now", () => {
    const s = start(createInitialState("act1", "score1"), 1_000);
    saveState(s);

    const loaded = loadState("act1", "score1")!;
    expect(loaded.running).toBe(true);
    expect(loaded.startedAt).toBe(1_000);
    // Simulating "now = 5000": elapsed = 0 (acc) + (5000 - 1000) = 4000.
    expect(elapsedMs(loaded, 5_000)).toBe(4_000);
  });

  it("loadState returns null when stored payload references a different (activity, score)", () => {
    const s = start(createInitialState("act1", "score1"), 0);
    saveState(s);
    // Tamper with the stored payload's identifiers.
    const raw = localStorage.getItem(storageKey("act1", "score1"))!;
    const tampered = JSON.parse(raw);
    tampered.activityId = "actX";
    localStorage.setItem(storageKey("act1", "score1"), JSON.stringify(tampered));

    expect(loadState("act1", "score1")).toBeNull();
  });

  it("clearState wipes the stored payload", () => {
    const s = start(createInitialState("act1", "score1"), 0);
    saveState(s);
    clearState("act1", "score1");
    expect(loadState("act1", "score1")).toBeNull();
  });

  it("loadState returns null when stored value is corrupt JSON", () => {
    localStorage.setItem(storageKey("act1", "score1"), "{not json");
    expect(loadState("act1", "score1")).toBeNull();
  });
});

describe("isTerminalState", () => {
  it("is false for a brand-new initial state", () => {
    expect(isTerminalState(createInitialState("a", "s"))).toBe(false);
  });

  it("is false while the timer is running with no laps", () => {
    const s = start(createInitialState("a", "s"), 0);
    expect(isTerminalState(s)).toBe(false);
  });

  it("is false when laps are still pending assignment", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = pause(s, 2_000);
    expect(isTerminalState(s)).toBe(false);
  });

  it("is true when laps were recorded, all assigned, timer paused", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = pause(s, 2_000);
    s = removeLap(s, "a"); // simulate all laps assigned away
    expect(isTerminalState(s)).toBe(true);
  });

  it("is false when the lap list is empty but the timer is still running", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = removeLap(s, "a");
    // still running — instructor may add more laps
    expect(isTerminalState(s)).toBe(false);
  });
});

describe("isStaleRunningState", () => {
  it("is false when the timer isn't running", () => {
    expect(isStaleRunningState(createInitialState("a", "s"), 99_999_999_999)).toBe(false);
  });

  it("is false when the timer just started", () => {
    const s = start(createInitialState("a", "s"), 1_000);
    expect(isStaleRunningState(s, 1_000)).toBe(false);
  });

  it("is false at exactly the threshold (boundary)", () => {
    const s = start(createInitialState("a", "s"), 0);
    expect(isStaleRunningState(s, STALE_RUNNING_THRESHOLD_MS)).toBe(false);
  });

  it("is true once `now - startedAt` exceeds the threshold", () => {
    const s = start(createInitialState("a", "s"), 0);
    expect(isStaleRunningState(s, STALE_RUNNING_THRESHOLD_MS + 1)).toBe(true);
  });

  it("respects an injected threshold for testability", () => {
    const s = start(createInitialState("a", "s"), 0);
    expect(isStaleRunningState(s, 5_000, 4_000)).toBe(true);
    expect(isStaleRunningState(s, 5_000, 6_000)).toBe(false);
  });
});

describe("loadFreshState", () => {
  // Stub localStorage for this group too.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
    } as Storage);
  });

  it("returns null and wipes storage when state is terminal", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = pause(s, 2_000);
    s = removeLap(s, "a");
    saveState(s);

    expect(loadFreshState("a", "s", 3_000)).toBeNull();
    // Storage is wiped — a subsequent load sees nothing.
    expect(loadState("a", "s")).toBeNull();
  });

  it("returns null and wipes storage when running state is stale", () => {
    const s = start(createInitialState("a", "s"), 0);
    saveState(s);

    const now = STALE_RUNNING_THRESHOLD_MS + 10_000;
    expect(loadFreshState("a", "s", now)).toBeNull();
    expect(loadState("a", "s")).toBeNull();
  });

  it("returns the loaded state for an in-progress session (laps still pending)", () => {
    let s = start(createInitialState("a", "s"), 0);
    s = recordLap(s, 1_000, "a");
    s = pause(s, 2_000);
    saveState(s);

    const fresh = loadFreshState("a", "s", 3_000);
    expect(fresh).not.toBeNull();
    expect(fresh!.laps.map((l) => l.id)).toEqual(["a"]);
  });

  it("returns the loaded state for a still-fresh running timer", () => {
    const s = start(createInitialState("a", "s"), 0);
    saveState(s);

    const now = STALE_RUNNING_THRESHOLD_MS - 1; // under threshold
    const fresh = loadFreshState("a", "s", now);
    expect(fresh).not.toBeNull();
    expect(fresh!.running).toBe(true);
  });

  it("returns null without touching storage when nothing is stored", () => {
    expect(loadFreshState("missing", "s", 0)).toBeNull();
  });
});
