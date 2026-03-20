import { describe, it, expect } from "vitest";
import { toE164, toIsraeliDisplay, isValidIsraeliPhone } from "../phone";

describe("toE164", () => {
  it("converts local Israeli format (050-123-4567)", () => {
    expect(toE164("050-123-4567")).toBe("+972501234567");
  });

  it("converts local format without dashes (0501234567)", () => {
    expect(toE164("0501234567")).toBe("+972501234567");
  });

  it("converts local format with spaces", () => {
    expect(toE164("050 123 4567")).toBe("+972501234567");
  });

  it("passes through +972 format (12 digits)", () => {
    expect(toE164("+972501234567")).toBe("+972501234567");
  });

  it("handles 972 without + prefix", () => {
    expect(toE164("972501234567")).toBe("+972501234567");
  });

  it("returns null for too-short numbers", () => {
    expect(toE164("050123")).toBeNull();
  });

  it("returns null for too-long numbers", () => {
    expect(toE164("05012345678")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toE164("")).toBeNull();
  });

  it("returns null for non-Israeli format", () => {
    expect(toE164("1234567890")).toBeNull();
  });

  it("returns null for letters", () => {
    expect(toE164("abcdefghij")).toBeNull();
  });

  it("strips parentheses and other chars", () => {
    expect(toE164("(050) 123-4567")).toBe("+972501234567");
  });
});

describe("toIsraeliDisplay", () => {
  it("converts E.164 to display format", () => {
    expect(toIsraeliDisplay("+972501234567")).toBe("050-123-4567");
  });

  it("returns input unchanged for non-Israeli numbers", () => {
    expect(toIsraeliDisplay("+14155551234")).toBe("+14155551234");
  });

  it("returns input unchanged for malformed E.164", () => {
    expect(toIsraeliDisplay("+97250123")).toBe("+97250123");
  });
});

describe("isValidIsraeliPhone", () => {
  it("returns true for valid local format", () => {
    expect(isValidIsraeliPhone("0501234567")).toBe(true);
  });

  it("returns true for valid E.164 format", () => {
    expect(isValidIsraeliPhone("+972501234567")).toBe(true);
  });

  it("returns false for invalid number", () => {
    expect(isValidIsraeliPhone("12345")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidIsraeliPhone("")).toBe(false);
  });
});
