import { describe, it, expect } from "vitest";
import { parseGradeInput, parseCompactTimeInput, formatGradeDisplay } from "../score-format";

describe("parseGradeInput", () => {
  it("returns null for empty string", () => {
    expect(parseGradeInput("")).toBeNull();
    expect(parseGradeInput("  ")).toBeNull();
  });

  it("parses plain numbers", () => {
    expect(parseGradeInput("85")).toBe(85);
    expect(parseGradeInput("0")).toBe(0);
    expect(parseGradeInput("99.5")).toBe(99.5);
  });

  it("parses M:SS time format to seconds", () => {
    expect(parseGradeInput("3:15")).toBe(195);
    expect(parseGradeInput("0:30")).toBe(30);
    expect(parseGradeInput("1:00")).toBe(60);
    expect(parseGradeInput("12:05")).toBe(725);
  });

  it("rejects invalid seconds >= 60", () => {
    expect(parseGradeInput("3:60")).toBeNull();
    expect(parseGradeInput("1:99")).toBeNull();
  });

  it("parses HH:MM:SS time format to seconds", () => {
    expect(parseGradeInput("00:10:56")).toBe(656);
    expect(parseGradeInput("00:00:30")).toBe(30);
    expect(parseGradeInput("01:00:00")).toBe(3600);
    expect(parseGradeInput("00:12:05")).toBe(725);
  });

  it("rejects HH:MM:SS with invalid minutes/seconds", () => {
    expect(parseGradeInput("00:60:00")).toBeNull();
    expect(parseGradeInput("00:00:60")).toBeNull();
  });

  it("rejects HH:MM:SS when format is number", () => {
    expect(parseGradeInput("00:10:56", "number")).toBeNull();
  });

  it("accepts HH:MM:SS when format is time", () => {
    expect(parseGradeInput("00:10:56", "time")).toBe(656);
  });

  it("rejects malformed time strings", () => {
    expect(parseGradeInput("3:5")).toBeNull(); // needs two-digit seconds
    expect(parseGradeInput(":30")).toBeNull();
    expect(parseGradeInput("abc")).toBeNull();
    expect(parseGradeInput("3:")).toBeNull();
  });

  it("handles whitespace", () => {
    expect(parseGradeInput(" 3:15 ")).toBe(195);
    expect(parseGradeInput(" 85 ")).toBe(85);
  });

  it("rejects M:SS when format is number", () => {
    expect(parseGradeInput("3:15", "number")).toBeNull();
    expect(parseGradeInput("0:30", "number")).toBeNull();
  });

  it("accepts plain numbers when format is number", () => {
    expect(parseGradeInput("85", "number")).toBe(85);
    expect(parseGradeInput("99.5", "number")).toBe(99.5);
  });

  it("accepts M:SS when format is time", () => {
    expect(parseGradeInput("3:15", "time")).toBe(195);
  });

  it("accepts plain numbers when format is time", () => {
    expect(parseGradeInput("195", "time")).toBe(195);
  });
});

describe("parseCompactTimeInput", () => {
  it("returns null for empty/whitespace", () => {
    expect(parseCompactTimeInput("")).toBeNull();
    expect(parseCompactTimeInput("   ")).toBeNull();
  });

  it("parses digit-only input as compact M:SS time (last 2 digits = seconds)", () => {
    expect(parseCompactTimeInput("0")).toBe(0);
    expect(parseCompactTimeInput("00")).toBe(0);
    expect(parseCompactTimeInput("5")).toBe(5);
    expect(parseCompactTimeInput("43")).toBe(43);
    expect(parseCompactTimeInput("103")).toBe(63);
    expect(parseCompactTimeInput("1215")).toBe(12 * 60 + 15);
    expect(parseCompactTimeInput("12345")).toBe(123 * 60 + 45);
  });

  it("trims whitespace on digit-only input", () => {
    expect(parseCompactTimeInput("  103  ")).toBe(63);
  });

  it("delegates colon-form input to the time parser", () => {
    expect(parseCompactTimeInput("3:15")).toBe(195);
    expect(parseCompactTimeInput("0:30")).toBe(30);
    expect(parseCompactTimeInput("12:05")).toBe(725);
    expect(parseCompactTimeInput("00:10:56")).toBe(656);
  });

  it("rejects malformed colon input", () => {
    expect(parseCompactTimeInput("3:60")).toBeNull();
    expect(parseCompactTimeInput("3:5")).toBeNull();
    expect(parseCompactTimeInput(":30")).toBeNull();
    expect(parseCompactTimeInput("3:")).toBeNull();
  });

  it("rejects non-digit garbage", () => {
    expect(parseCompactTimeInput("abc")).toBeNull();
    expect(parseCompactTimeInput("3.5")).toBeNull();
    expect(parseCompactTimeInput("-5")).toBeNull();
    expect(parseCompactTimeInput("1:2:3:4")).toBeNull();
  });
});

describe("formatGradeDisplay", () => {
  it("returns empty string for null", () => {
    expect(formatGradeDisplay(null)).toBe("");
    expect(formatGradeDisplay(null, "time")).toBe("");
  });

  it("formats number as plain string", () => {
    expect(formatGradeDisplay(85)).toBe("85");
    expect(formatGradeDisplay(99.5)).toBe("99.5");
    expect(formatGradeDisplay(0)).toBe("0");
  });

  it("formats number with explicit number format", () => {
    expect(formatGradeDisplay(85, "number")).toBe("85");
  });

  it("formats seconds as M:SS for time format", () => {
    expect(formatGradeDisplay(195, "time")).toBe("3:15");
    expect(formatGradeDisplay(30, "time")).toBe("0:30");
    expect(formatGradeDisplay(60, "time")).toBe("1:00");
    expect(formatGradeDisplay(725, "time")).toBe("12:05");
  });

  it("rounds fractional seconds", () => {
    expect(formatGradeDisplay(195.4, "time")).toBe("3:15");
    expect(formatGradeDisplay(195.6, "time")).toBe("3:16");
  });

  it("pads seconds to two digits", () => {
    expect(formatGradeDisplay(5, "time")).toBe("0:05");
    expect(formatGradeDisplay(61, "time")).toBe("1:01");
  });
});
