import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseMedicalAppointments,
  hasUpcomingAppointment,
  formatAppointment,
} from "../medical-appointments";

describe("parseMedicalAppointments", () => {
  it("returns empty array for null/undefined", () => {
    expect(parseMedicalAppointments(null)).toEqual([]);
    expect(parseMedicalAppointments(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseMedicalAppointments("")).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseMedicalAppointments("not json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseMedicalAppointments('{"id":"1"}')).toEqual([]);
  });

  it("parses valid JSON string", () => {
    const json = JSON.stringify([
      { id: "1", date: "2026-04-10", place: "Hospital", type: "Physio" },
    ]);
    const result = parseMedicalAppointments(json);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
    expect(result[0].date).toBe("2026-04-10");
    expect(result[0].place).toBe("Hospital");
    expect(result[0].type).toBe("Physio");
  });

  it("accepts an array directly (Prisma JSON field)", () => {
    const arr = [
      { id: "1", date: "2026-04-10", place: "Clinic", type: "Checkup" },
    ];
    const result = parseMedicalAppointments(arr);
    expect(result).toHaveLength(1);
    expect(result[0].place).toBe("Clinic");
  });

  it("filters out invalid entries", () => {
    const json = JSON.stringify([
      { id: "1", date: "2026-04-10", place: "A", type: "B" },
      { bad: true },
      null,
      { id: "2", date: "2026-04-12", place: "C", type: "D" },
    ]);
    const result = parseMedicalAppointments(json);
    expect(result).toHaveLength(2);
  });
});

describe("hasUpcomingAppointment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false for empty array", () => {
    expect(hasUpcomingAppointment([])).toBe(false);
  });

  it("returns true if any appointment is today or future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));

    expect(
      hasUpcomingAppointment([
        { id: "1", date: "2026-04-07", place: "", type: "" },
      ]),
    ).toBe(true);

    expect(
      hasUpcomingAppointment([
        { id: "1", date: "2026-04-20", place: "", type: "" },
      ]),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("returns false if all appointments are in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));

    expect(
      hasUpcomingAppointment([
        { id: "1", date: "2026-04-01", place: "", type: "" },
        { id: "2", date: "2026-04-05", place: "", type: "" },
      ]),
    ).toBe(false);

    vi.useRealTimers();
  });
});

describe("formatAppointment", () => {
  it("formats with all fields", () => {
    const result = formatAppointment({
      id: "1",
      date: "2026-04-10",
      place: "Hospital",
      type: "Physio",
    });
    expect(result).toContain("Physio");
    expect(result).toContain("Hospital");
    expect(result).toContain("/");
  });

  it("omits empty fields", () => {
    const result = formatAppointment({
      id: "1",
      date: "2026-04-10",
      place: "",
      type: "",
    });
    // Should only have the date
    expect(result).not.toContain(" / ");
  });
});
