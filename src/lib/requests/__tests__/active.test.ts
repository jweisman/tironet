import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isRequestActive,
  isRequestOpen,
  isRequestUrgent,
  getLeaveOnDate,
  formatLeaveOnDateLabel,
  formatMedicalApptShortLabel,
  SICK_DAY_SHORT_LABEL,
} from "../active";

// ---------------------------------------------------------------------------
// isRequestActive
// ---------------------------------------------------------------------------

describe("isRequestActive", () => {
  it("returns false for non-approved requests", () => {
    expect(isRequestActive({ status: "open", type: "leave" }, "2026-04-15")).toBe(false);
    expect(isRequestActive({ status: "denied", type: "leave" }, "2026-04-15")).toBe(false);
  });

  it("returns false for approved hardship (not date-based)", () => {
    expect(isRequestActive({ status: "approved", type: "hardship" }, "2026-04-15")).toBe(false);
  });

  // --- Leave ---

  it("returns true when leave departure is today or future", () => {
    expect(
      isRequestActive(
        { status: "approved", type: "leave", departureAt: "2026-04-15T08:00:00Z", returnAt: "2026-04-10T18:00:00Z" },
        "2026-04-15",
      ),
    ).toBe(true);
  });

  it("returns true when leave return is today or future", () => {
    expect(
      isRequestActive(
        { status: "approved", type: "leave", departureAt: "2026-04-10T08:00:00Z", returnAt: "2026-04-20T18:00:00Z" },
        "2026-04-15",
      ),
    ).toBe(true);
  });

  it("returns false when leave dates are all past", () => {
    expect(
      isRequestActive(
        { status: "approved", type: "leave", departureAt: "2026-04-01T08:00:00Z", returnAt: "2026-04-05T18:00:00Z" },
        "2026-04-15",
      ),
    ).toBe(false);
  });

  it("returns false when leave dates are null", () => {
    expect(
      isRequestActive(
        { status: "approved", type: "leave", departureAt: null, returnAt: null },
        "2026-04-15",
      ),
    ).toBe(false);
  });

  // --- Medical ---

  it("returns true for medical with upcoming appointment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "medical",
        medicalAppointments: JSON.stringify([
          { id: "1", date: "2026-04-20", place: "Hospital", type: "Checkup" },
        ]),
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("returns false for medical with only past appointments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "medical",
        medicalAppointments: JSON.stringify([
          { id: "1", date: "2026-04-01", place: "Hospital", type: "Checkup" },
        ]),
      }),
    ).toBe(false);

    vi.useRealTimers();
  });

  it("returns false for medical with null appointments and no sick days", () => {
    expect(
      isRequestActive(
        { status: "approved", type: "medical", medicalAppointments: null, sickDays: null },
        "2026-04-15",
      ),
    ).toBe(false);
  });

  it("returns true for medical with upcoming sick day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "medical",
        medicalAppointments: null,
        sickDays: JSON.stringify([{ id: "d1", date: "2026-04-18" }]),
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("returns false for medical with only past sick days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "medical",
        medicalAppointments: null,
        sickDays: JSON.stringify([{ id: "d1", date: "2026-04-01" }]),
      }),
    ).toBe(false);

    vi.useRealTimers();
  });

  it("returns true for medical with past appointments but upcoming sick day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "medical",
        medicalAppointments: JSON.stringify([{ id: "a1", date: "2026-04-01", place: "X", type: "Y" }]),
        sickDays: JSON.stringify([{ id: "d1", date: "2026-04-20" }]),
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("accepts medicalAppointments as an array (Prisma JSON)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "medical",
        medicalAppointments: [
          { id: "1", date: "2026-04-20", place: "Clinic", type: "Visit" },
        ],
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  // --- Unknown type ---

  it("returns false for unknown approved type", () => {
    expect(isRequestActive({ status: "approved", type: "other" }, "2026-04-15")).toBe(false);
  });

  // --- Default today ---

  it("uses current date when today param is omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    expect(
      isRequestActive({
        status: "approved",
        type: "leave",
        departureAt: "2026-04-15T08:00:00Z",
      }),
    ).toBe(true);

    expect(
      isRequestActive({
        status: "approved",
        type: "leave",
        departureAt: "2026-04-10T08:00:00Z",
        returnAt: "2026-04-12T18:00:00Z",
      }),
    ).toBe(false);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// isRequestOpen
// ---------------------------------------------------------------------------

describe("isRequestOpen", () => {
  it("returns true for status 'open'", () => {
    expect(isRequestOpen({ status: "open", type: "leave" }, "2026-04-15")).toBe(true);
  });

  it("returns true for active approved leave request", () => {
    expect(
      isRequestOpen({ status: "approved", type: "leave", departureAt: "2026-04-20T08:00:00Z" }, "2026-04-15"),
    ).toBe(true);
  });

  it("returns false for approved hardship (not date-based active)", () => {
    expect(
      isRequestOpen({ status: "approved", type: "hardship" }, "2026-04-15"),
    ).toBe(false);
  });

  it("returns false for denied request", () => {
    expect(isRequestOpen({ status: "denied", type: "leave" }, "2026-04-15")).toBe(false);
  });

  it("returns false for approved leave with past dates", () => {
    expect(
      isRequestOpen(
        { status: "approved", type: "leave", departureAt: "2026-04-01T08:00:00Z", returnAt: "2026-04-05T18:00:00Z" },
        "2026-04-15",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRequestUrgent
// ---------------------------------------------------------------------------

describe("isRequestUrgent", () => {
  it("returns false for non-urgent medical", () => {
    expect(isRequestUrgent({ type: "medical", urgent: false })).toBe(false);
  });

  it("returns true for urgent medical (boolean)", () => {
    expect(isRequestUrgent({ type: "medical", urgent: true })).toBe(true);
  });

  it("returns true for urgent medical (SQLite integer 1)", () => {
    expect(isRequestUrgent({ type: "medical", urgent: 1 })).toBe(true);
  });

  it("returns false for medical with urgent=0", () => {
    expect(isRequestUrgent({ type: "medical", urgent: 0 })).toBe(false);
  });

  it("returns false for medical with urgent=null", () => {
    expect(isRequestUrgent({ type: "medical", urgent: null })).toBe(false);
  });

  it("returns true for hardship with specialConditions (boolean)", () => {
    expect(isRequestUrgent({ type: "hardship", specialConditions: true })).toBe(true);
  });

  it("returns true for hardship with specialConditions (SQLite integer 1)", () => {
    expect(isRequestUrgent({ type: "hardship", specialConditions: 1 })).toBe(true);
  });

  it("returns true for hardship with urgent flag", () => {
    expect(isRequestUrgent({ type: "hardship", urgent: true })).toBe(true);
  });

  it("returns true for hardship with both urgent and specialConditions", () => {
    expect(isRequestUrgent({ type: "hardship", urgent: true, specialConditions: true })).toBe(true);
  });

  it("returns false for hardship without urgent or specialConditions", () => {
    expect(isRequestUrgent({ type: "hardship", urgent: false, specialConditions: false })).toBe(false);
  });

  it("returns false for hardship with null values", () => {
    expect(isRequestUrgent({ type: "hardship", urgent: null, specialConditions: null })).toBe(false);
  });

  it("returns false for leave type regardless of flags", () => {
    expect(isRequestUrgent({ type: "leave", urgent: true })).toBe(false);
  });

  it("returns false for unknown type", () => {
    expect(isRequestUrgent({ type: "other" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getLeaveOnDate
// ---------------------------------------------------------------------------

describe("getLeaveOnDate", () => {
  it("classifies departure-on-date when departureAt falls on the date", () => {
    expect(
      getLeaveOnDate("2026-04-15T11:00:00Z", "2026-04-18T18:00:00Z", "2026-04-15"),
    ).toEqual({ kind: "departure", iso: "2026-04-15T11:00:00Z" });
  });

  it("classifies return-on-date when only returnAt falls on the date", () => {
    expect(
      getLeaveOnDate("2026-04-10T08:00:00Z", "2026-04-15T13:00:00Z", "2026-04-15"),
    ).toEqual({ kind: "return", iso: "2026-04-15T13:00:00Z" });
  });

  it("classifies mid-stretch when neither boundary is on the date", () => {
    expect(
      getLeaveOnDate("2026-04-10T08:00:00Z", "2026-04-20T18:00:00Z", "2026-04-15"),
    ).toEqual({ kind: "mid", iso: null });
  });

  it("prefers departure when both fall on the date (single-day leave)", () => {
    expect(
      getLeaveOnDate("2026-04-15T08:00:00Z", "2026-04-15T16:00:00Z", "2026-04-15"),
    ).toEqual({ kind: "departure", iso: "2026-04-15T08:00:00Z" });
  });

  it("swaps to return on a single-day leave once departure has passed", () => {
    // now is between departure (08:00) and return (16:00)
    const now = new Date("2026-04-15T10:00:00Z");
    expect(
      getLeaveOnDate("2026-04-15T08:00:00Z", "2026-04-15T16:00:00Z", "2026-04-15", now),
    ).toEqual({ kind: "return", iso: "2026-04-15T16:00:00Z" });
  });

  it("keeps departure on a single-day leave when departure is still upcoming", () => {
    const now = new Date("2026-04-15T07:00:00Z");
    expect(
      getLeaveOnDate("2026-04-15T08:00:00Z", "2026-04-15T16:00:00Z", "2026-04-15", now),
    ).toEqual({ kind: "departure", iso: "2026-04-15T08:00:00Z" });
  });

  it("flips a multi-day leave to mid (ביציאה) once departure has passed", () => {
    // Departure today at 08:00, return tomorrow — at 10:00 the soldier is on leave
    const now = new Date("2026-04-15T10:00:00Z");
    expect(
      getLeaveOnDate("2026-04-15T08:00:00Z", "2026-04-16T18:00:00Z", "2026-04-15", now),
    ).toEqual({ kind: "mid", iso: null });
  });

  it("keeps a multi-day leave on departure when it hasn't passed yet", () => {
    const now = new Date("2026-04-15T07:00:00Z");
    expect(
      getLeaveOnDate("2026-04-15T08:00:00Z", "2026-04-16T18:00:00Z", "2026-04-15", now),
    ).toEqual({ kind: "departure", iso: "2026-04-15T08:00:00Z" });
  });

  it("accepts Date objects in addition to strings", () => {
    const dep = new Date("2026-04-15T11:00:00Z");
    const ret = new Date("2026-04-18T18:00:00Z");
    expect(getLeaveOnDate(dep, ret, "2026-04-15").kind).toBe("departure");
  });

  it("returns mid for null inputs", () => {
    expect(getLeaveOnDate(null, null, "2026-04-15")).toEqual({ kind: "mid", iso: null });
  });
});

// ---------------------------------------------------------------------------
// formatLeaveOnDateLabel
// ---------------------------------------------------------------------------

describe("formatLeaveOnDateLabel", () => {
  it("renders יציאה עד {time} for departures", () => {
    expect(
      formatLeaveOnDateLabel(
        { kind: "departure", iso: "2026-04-15T11:30:00Z" },
        { timeZone: "Asia/Jerusalem" },
      ),
    ).toBe("יציאה עד 14:30");
  });

  it("renders חזרה עד {time} for returns", () => {
    expect(
      formatLeaveOnDateLabel(
        { kind: "return", iso: "2026-04-15T13:00:00Z" },
        { timeZone: "Asia/Jerusalem" },
      ),
    ).toBe("חזרה עד 16:00");
  });

  it("renders ביציאה for mid-stretch", () => {
    expect(formatLeaveOnDateLabel({ kind: "mid", iso: null })).toBe("ביציאה");
  });

  it("falls back to ביציאה when iso has no time component", () => {
    expect(
      formatLeaveOnDateLabel({ kind: "departure", iso: "2026-04-15" }),
    ).toBe("ביציאה");
  });

  it("falls back to ביציאה for midnight-UTC iso (date-only)", () => {
    expect(
      formatLeaveOnDateLabel({ kind: "return", iso: "2026-04-15T00:00:00.000Z" }),
    ).toBe("ביציאה");
  });
});

// ---------------------------------------------------------------------------
// formatMedicalApptShortLabel
// ---------------------------------------------------------------------------

describe("formatMedicalApptShortLabel", () => {
  it("renders תור רפואי בשעה {time} when a time is present", () => {
    expect(
      formatMedicalApptShortLabel(
        { date: "2026-04-15T11:30:00Z" },
        { timeZone: "Asia/Jerusalem" },
      ),
    ).toBe("תור רפואי בשעה 14:30");
  });

  it("renders תור רפואי for date-only appointments", () => {
    expect(formatMedicalApptShortLabel({ date: "2026-04-15" })).toBe("תור רפואי");
  });

  it("renders תור רפואי for midnight-UTC iso (date-only)", () => {
    expect(formatMedicalApptShortLabel({ date: "2026-04-15T00:00:00.000Z" })).toBe(
      "תור רפואי",
    );
  });
});

// ---------------------------------------------------------------------------
// SICK_DAY_SHORT_LABEL
// ---------------------------------------------------------------------------

describe("SICK_DAY_SHORT_LABEL", () => {
  it("is the Hebrew sick-day short label", () => {
    expect(SICK_DAY_SHORT_LABEL).toBe("ביום מחלה");
  });
});
