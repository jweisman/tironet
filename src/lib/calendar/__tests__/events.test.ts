import { describe, it, expect } from "vitest";
import {
  expandLeaveDates,
  buildCalendarEvents,
  groupEventsByDate,
  getEventHref,
  getMonthBounds,
  getThreeMonthRange,
  getPlatoonColorMap,
  visibleTypesToFilters,
  filtersToEventTypes,
  type RawActivity,
  type RawRequest,
  type RawCommanderEventData,
  type CalendarEvent,
  type CalendarFilterCategory,
} from "../events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActivity(overrides: Partial<RawActivity> = {}): RawActivity {
  return {
    id: "a1",
    name: "ירי 50",
    date: "2026-04-01",
    platoonId: "p1",
    platoonName: "מחלקה 1",
    activityTypeIcon: "target",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<RawRequest> = {}): RawRequest {
  return {
    id: "r1",
    type: "leave",
    status: "approved",
    departureAt: "2026-04-05T08:00:00.000Z",
    returnAt: "2026-04-07T18:00:00.000Z",
    medicalAppointments: null,
    sickDays: null,
    soldierName: "כהן אבי",
    platoonId: "p1",
    platoonName: "מחלקה 1",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    date: "2026-04-01",
    type: "activity",
    label: "ירי 50",
    platoonId: "p1",
    platoonName: "מחלקה 1",
    sourceId: "a1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// expandLeaveDates
// ---------------------------------------------------------------------------

describe("expandLeaveDates", () => {
  it("expands a single-day leave", () => {
    const dates = expandLeaveDates("2026-04-05T08:00:00.000Z", "2026-04-05T18:00:00.000Z");
    expect(dates).toEqual(["2026-04-05"]);
  });

  it("expands a multi-day leave", () => {
    const dates = expandLeaveDates("2026-04-05T08:00:00.000Z", "2026-04-07T18:00:00.000Z");
    expect(dates).toEqual(["2026-04-05", "2026-04-06", "2026-04-07"]);
  });

  it("handles month boundaries", () => {
    const dates = expandLeaveDates("2026-04-29T08:00:00Z", "2026-05-02T18:00:00Z");
    expect(dates).toEqual(["2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02"]);
  });

  it("handles long leave ranges", () => {
    const dates = expandLeaveDates("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z");
    expect(dates.length).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// buildCalendarEvents
// ---------------------------------------------------------------------------

describe("buildCalendarEvents", () => {
  const range = { start: "2026-04-01", end: "2026-04-30" };

  it("creates activity events", () => {
    const events = buildCalendarEvents([makeActivity()], [], range.start, range.end);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "activity",
      label: "ירי 50",
      sourceId: "a1",
      date: "2026-04-01",
      icon: "target",
    });
  });

  it("filters activities outside date range", () => {
    const events = buildCalendarEvents(
      [makeActivity({ date: "2026-03-15" })],
      [],
      range.start,
      range.end,
    );
    expect(events).toHaveLength(0);
  });

  it("expands leave requests into per-day events", () => {
    const events = buildCalendarEvents([], [makeRequest()], range.start, range.end);
    expect(events).toHaveLength(3); // Apr 5, 6, 7
    expect(events.every((e) => e.type === "leave")).toBe(true);
    expect(events.every((e) => e.sourceId === "r1")).toBe(true);
    expect(events.map((e) => e.date)).toEqual(["2026-04-05", "2026-04-06", "2026-04-07"]);
  });

  it("only includes leave events within range", () => {
    const events = buildCalendarEvents(
      [],
      [makeRequest({ departureAt: "2026-03-30T08:00:00Z", returnAt: "2026-04-02T18:00:00Z" })],
      range.start,
      range.end,
    );
    // Mar 30, 31 out of range; Apr 1, 2 in range
    expect(events).toHaveLength(2);
    expect(events[0].date).toBe("2026-04-01");
    expect(events[1].date).toBe("2026-04-02");
  });

  it("skips non-approved leave requests", () => {
    const events = buildCalendarEvents(
      [],
      [makeRequest({ status: "open" })],
      range.start,
      range.end,
    );
    expect(events).toHaveLength(0);
  });

  it("creates medical appointment events from JSON", () => {
    const events = buildCalendarEvents(
      [],
      [
        makeRequest({
          type: "medical",
          status: "approved",
          departureAt: null,
          returnAt: null,
          medicalAppointments: JSON.stringify([
            { id: "ma1", date: "2026-04-10", place: "בסיס", type: "עיניים" },
            { id: "ma2", date: "2026-05-01", place: "בסיס", type: "שיניים" },
          ]),
        }),
      ],
      range.start,
      range.end,
    );
    // Only Apr 10 is in range
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "medical_appointment",
      date: "2026-04-10",
      sourceId: "r1",
    });
  });

  it("creates sick day events from JSON", () => {
    const events = buildCalendarEvents(
      [],
      [
        makeRequest({
          type: "medical",
          status: "approved",
          departureAt: null,
          returnAt: null,
          sickDays: JSON.stringify([
            { id: "sd1", date: "2026-04-12" },
            { id: "sd2", date: "2026-04-13" },
          ]),
        }),
      ],
      range.start,
      range.end,
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === "sick_day")).toBe(true);
  });

  it("handles appointments with time component", () => {
    const events = buildCalendarEvents(
      [],
      [
        makeRequest({
          type: "medical",
          status: "approved",
          departureAt: null,
          returnAt: null,
          medicalAppointments: JSON.stringify([
            { id: "ma1", date: "2026-04-10T14:30", place: "בסיס", type: "עיניים" },
          ]),
        }),
      ],
      range.start,
      range.end,
    );
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-04-10");
  });

  it("generates unique event IDs", () => {
    const events = buildCalendarEvents(
      [makeActivity({ id: "a1" }), makeActivity({ id: "a2", date: "2026-04-02" })],
      [makeRequest({ id: "r1" })],
      range.start,
      range.end,
    );
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// groupEventsByDate
// ---------------------------------------------------------------------------

describe("groupEventsByDate", () => {
  it("groups events by date", () => {
    const events = [
      makeEvent({ date: "2026-04-01", id: "e1" }),
      makeEvent({ date: "2026-04-01", id: "e2" }),
      makeEvent({ date: "2026-04-02", id: "e3" }),
    ];
    const map = groupEventsByDate(events);
    expect(map.size).toBe(2);
    expect(map.get("2026-04-01")).toHaveLength(2);
    expect(map.get("2026-04-02")).toHaveLength(1);
  });

  it("returns empty map for no events", () => {
    expect(groupEventsByDate([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getEventHref
// ---------------------------------------------------------------------------

describe("getEventHref", () => {
  it("links activities to /activities/:id", () => {
    expect(getEventHref(makeEvent({ type: "activity", sourceId: "abc" }))).toBe("/activities/abc");
  });

  it("links leave to /requests/:id", () => {
    expect(getEventHref(makeEvent({ type: "leave", sourceId: "xyz" }))).toBe("/requests/xyz");
  });

  it("links medical appointments to /requests/:id", () => {
    expect(getEventHref(makeEvent({ type: "medical_appointment", sourceId: "xyz" }))).toBe("/requests/xyz");
  });

  it("links sick days to /requests/:id", () => {
    expect(getEventHref(makeEvent({ type: "sick_day", sourceId: "xyz" }))).toBe("/requests/xyz");
  });

  it("returns null for commander events", () => {
    expect(getEventHref(makeEvent({ type: "commander_event", sourceId: "xyz" }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMonthBounds
// ---------------------------------------------------------------------------

describe("getMonthBounds", () => {
  it("returns current month for empty events", () => {
    const { min, max } = getMonthBounds([]);
    const now = new Date();
    expect(min).toEqual({ year: now.getFullYear(), month: now.getMonth() });
    expect(max).toEqual({ year: now.getFullYear(), month: now.getMonth() });
  });

  it("computes min/max from events", () => {
    const events = [
      makeEvent({ date: "2026-03-15" }),
      makeEvent({ date: "2026-06-20" }),
    ];
    const { min, max } = getMonthBounds(events);
    expect(min).toEqual({ year: 2026, month: 2 }); // March = 2
    expect(max).toEqual({ year: 2026, month: 5 }); // June = 5
  });

  it("includes current month in range", () => {
    // Events only in the far future
    const events = [makeEvent({ date: "2027-12-01" })];
    const { min } = getMonthBounds(events);
    const now = new Date();
    expect(min).toEqual({ year: now.getFullYear(), month: now.getMonth() });
  });
});

// ---------------------------------------------------------------------------
// getThreeMonthRange
// ---------------------------------------------------------------------------

describe("getThreeMonthRange", () => {
  it("returns 3 months starting from the given date", () => {
    const result = getThreeMonthRange("2026-04-15");
    expect(result.months).toEqual([
      { year: 2026, month: 3 }, // April
      { year: 2026, month: 4 }, // May
      { year: 2026, month: 5 }, // June
    ]);
    expect(result.startDate).toBe("2026-04-01");
    expect(result.endDate).toBe("2026-06-30");
  });

  it("handles year boundary", () => {
    const result = getThreeMonthRange("2026-11-01");
    expect(result.months).toEqual([
      { year: 2026, month: 10 }, // November
      { year: 2026, month: 11 }, // December
      { year: 2027, month: 0 },  // January
    ]);
    expect(result.endDate).toBe("2027-01-31");
  });
});

// ---------------------------------------------------------------------------
// getPlatoonColorMap
// ---------------------------------------------------------------------------

describe("getPlatoonColorMap", () => {
  it("assigns colors in order", () => {
    const map = getPlatoonColorMap(["p1", "p2", "p3"]);
    expect(map.size).toBe(3);
    expect(map.get("p1")!.hex).not.toBe(map.get("p2")!.hex);
  });

  it("wraps around for >8 platoons", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const map = getPlatoonColorMap(ids);
    expect(map.get("p0")!.hex).toBe(map.get("p8")!.hex);
  });
});

// ---------------------------------------------------------------------------
// Filter categories
// ---------------------------------------------------------------------------

describe("visibleTypesToFilters", () => {
  it("maps all event types to 4 filters", () => {
    const filters = visibleTypesToFilters(["activity", "leave", "medical_appointment", "sick_day", "commander_event"]);
    expect(filters).toEqual(["activity", "leave", "medical", "commander_event"]);
  });

  it("maps soldier event types to 3 filters", () => {
    const filters = visibleTypesToFilters(["activity", "leave", "medical_appointment", "sick_day"]);
    expect(filters).toEqual(["activity", "leave", "medical"]);
  });

  it("maps instructor types to activity only", () => {
    expect(visibleTypesToFilters(["activity"])).toEqual(["activity"]);
  });

  it("maps medic types to medical only", () => {
    expect(visibleTypesToFilters(["medical_appointment", "sick_day"])).toEqual(["medical"]);
  });

  it("creates medical filter from sick_day alone", () => {
    expect(visibleTypesToFilters(["sick_day"])).toEqual(["medical"]);
  });
});

describe("filtersToEventTypes", () => {
  it("expands medical filter to both event types", () => {
    const types = filtersToEventTypes(new Set<CalendarFilterCategory>(["medical"]));
    expect(types).toEqual(new Set(["medical_appointment", "sick_day"]));
  });

  it("expands all filters including commander_event", () => {
    const types = filtersToEventTypes(new Set<CalendarFilterCategory>(["activity", "leave", "medical", "commander_event"]));
    expect(types).toEqual(new Set(["activity", "leave", "medical_appointment", "sick_day", "commander_event"]));
  });

  it("returns empty set for no filters", () => {
    expect(filtersToEventTypes(new Set())).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// Commander events in buildCalendarEvents
// ---------------------------------------------------------------------------

describe("buildCalendarEvents — commander events", () => {
  const range = { start: "2026-04-01", end: "2026-04-30" };

  function makeCmdrEvent(overrides: Partial<RawCommanderEventData> = {}): RawCommanderEventData {
    return {
      id: "ce1",
      userName: "כהן יוסי",
      type: "leave",
      startDate: "2026-04-10",
      endDate: "2026-04-12",
      platoonId: "p1",
      platoonName: "מחלקה 1",
      ...overrides,
    };
  }

  it("expands commander event date range into individual days", () => {
    const events = buildCalendarEvents([], [], range.start, range.end, [makeCmdrEvent()]);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.date)).toEqual(["2026-04-10", "2026-04-11", "2026-04-12"]);
    expect(events[0]).toMatchObject({
      type: "commander_event",
      label: "כהן יוסי",
      icon: "DoorOpen",
      platoonId: "p1",
      sourceId: "ce1",
    });
  });

  it("filters commander events outside date range", () => {
    const events = buildCalendarEvents([], [], range.start, range.end, [
      makeCmdrEvent({ startDate: "2026-05-01", endDate: "2026-05-03" }),
    ]);
    expect(events).toHaveLength(0);
  });

  it("handles single-day commander events", () => {
    const events = buildCalendarEvents([], [], range.start, range.end, [
      makeCmdrEvent({ startDate: "2026-04-15", endDate: "2026-04-15" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-04-15");
  });

  it("combines all event types", () => {
    const events = buildCalendarEvents(
      [{ id: "a1", name: "ירי", date: "2026-04-01", platoonId: "p1", platoonName: "מחלקה 1", activityTypeIcon: "target" }],
      [],
      range.start,
      range.end,
      [makeCmdrEvent({ startDate: "2026-04-01", endDate: "2026-04-01" })],
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["activity", "commander_event"]);
  });
});
