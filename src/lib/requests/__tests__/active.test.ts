import { describe, it, expect, vi, afterEach } from "vitest";
import { isRequestActive, isRequestOpen, isRequestUrgent } from "../active";

// ---------------------------------------------------------------------------
// isRequestActive
// ---------------------------------------------------------------------------

describe("isRequestActive", () => {
  it("returns false for non-approved requests", () => {
    expect(isRequestActive({ status: "open", type: "leave" }, "2026-04-15")).toBe(false);
    expect(isRequestActive({ status: "denied", type: "leave" }, "2026-04-15")).toBe(false);
  });

  it("returns true for approved hardship (always active)", () => {
    expect(isRequestActive({ status: "approved", type: "hardship" }, "2026-04-15")).toBe(true);
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

  it("returns false for medical with null appointments", () => {
    expect(
      isRequestActive(
        { status: "approved", type: "medical", medicalAppointments: null },
        "2026-04-15",
      ),
    ).toBe(false);
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

  it("returns true for active approved request", () => {
    expect(
      isRequestOpen({ status: "approved", type: "hardship" }, "2026-04-15"),
    ).toBe(true);
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
