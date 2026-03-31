import { describe, it, expect } from "vitest";
import { parseGradeInput } from "../score-format";

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
});
