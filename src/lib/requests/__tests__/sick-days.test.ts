import { describe, it, expect, vi } from "vitest";
import { parseSickDays, hasUpcomingSickDay, formatSickDay, expandSickDayRange } from "../sick-days";

// ---------------------------------------------------------------------------
// parseSickDays
// ---------------------------------------------------------------------------

describe("parseSickDays", () => {
  it("returns empty array for null/undefined", () => {
    expect(parseSickDays(null)).toEqual([]);
    expect(parseSickDays(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseSickDays("")).toEqual([]);
  });

  it("parses JSON string into SickDay array", () => {
    const json = JSON.stringify([
      { id: "d1", date: "2026-04-15" },
      { id: "d2", date: "2026-04-16" },
    ]);
    const result = parseSickDays(json);
    expect(result).toEqual([
      { id: "d1", date: "2026-04-15" },
      { id: "d2", date: "2026-04-16" },
    ]);
  });

  it("accepts already-parsed array", () => {
    const arr = [{ id: "d1", date: "2026-04-15" }];
    expect(parseSickDays(arr)).toEqual(arr);
  });

  it("sorts by date ascending", () => {
    const json = JSON.stringify([
      { id: "d2", date: "2026-04-20" },
      { id: "d1", date: "2026-04-10" },
    ]);
    const result = parseSickDays(json);
    expect(result[0].date).toBe("2026-04-10");
    expect(result[1].date).toBe("2026-04-20");
  });

  it("filters out invalid items", () => {
    const json = JSON.stringify([
      { id: "d1", date: "2026-04-15" },
      { id: 123, date: "2026-04-16" }, // invalid id type
      null,
      { date: "2026-04-17" }, // missing id
    ]);
    const result = parseSickDays(json);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseSickDays("not json")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasUpcomingSickDay
// ---------------------------------------------------------------------------

describe("hasUpcomingSickDay", () => {
  it("returns true when any date is today or future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      hasUpcomingSickDay([
        { id: "d1", date: "2026-04-10" },
        { id: "d2", date: "2026-04-15" },
      ]),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("returns false when all dates are past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      hasUpcomingSickDay([
        { id: "d1", date: "2026-04-10" },
        { id: "d2", date: "2026-04-14" },
      ]),
    ).toBe(false);

    vi.useRealTimers();
  });

  it("returns false for empty array", () => {
    expect(hasUpcomingSickDay([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatSickDay
// ---------------------------------------------------------------------------

describe("formatSickDay", () => {
  it("formats date in Hebrew locale", () => {
    const result = formatSickDay({ id: "d1", date: "2026-04-15" });
    // Should contain day, month, year in some format
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });
});

// ---------------------------------------------------------------------------
// expandSickDayRange
// ---------------------------------------------------------------------------

describe("expandSickDayRange", () => {
  it("returns single day when no 'to' date", () => {
    const result = expandSickDayRange("2026-04-15");
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-15");
    expect(result[0].id).toBeTruthy();
  });

  it("returns single day when 'to' is null", () => {
    const result = expandSickDayRange("2026-04-15", null);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-15");
  });

  it("expands a date range into individual days", () => {
    const result = expandSickDayRange("2026-04-15", "2026-04-18");
    expect(result).toHaveLength(4);
    expect(result.map((d) => d.date)).toEqual([
      "2026-04-15",
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
    ]);
  });

  it("assigns unique IDs to each day", () => {
    const result = expandSickDayRange("2026-04-15", "2026-04-17");
    const ids = result.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
