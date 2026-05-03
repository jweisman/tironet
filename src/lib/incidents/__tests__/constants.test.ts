import { describe, it, expect } from "vitest";
import { INCIDENT_TYPE_LABELS, SUBTYPE_OPTIONS, getSubtypeLabel } from "../constants";

describe("INCIDENT_TYPE_LABELS", () => {
  it("has labels for all three types", () => {
    expect(INCIDENT_TYPE_LABELS.commendation).toBe("צל״ש");
    expect(INCIDENT_TYPE_LABELS.discipline).toBe("משמעת");
    expect(INCIDENT_TYPE_LABELS.safety).toBe("בטיחות");
  });
});

describe("SUBTYPE_OPTIONS", () => {
  it("provides subtypes for each type", () => {
    expect(SUBTYPE_OPTIONS.commendation.length).toBeGreaterThan(0);
    expect(SUBTYPE_OPTIONS.discipline.length).toBeGreaterThan(0);
    expect(SUBTYPE_OPTIONS.safety.length).toBeGreaterThan(0);
  });

  it("commendation includes fitness, teamwork, general", () => {
    const values = SUBTYPE_OPTIONS.commendation.map((o) => o.value);
    expect(values).toContain("fitness");
    expect(values).toContain("teamwork");
    expect(values).toContain("general");
  });

  it("discipline includes smoking, reliability, general", () => {
    const values = SUBTYPE_OPTIONS.discipline.map((o) => o.value);
    expect(values).toContain("smoking");
    expect(values).toContain("reliability");
    expect(values).toContain("general");
  });

  it("safety includes weapon, general", () => {
    const values = SUBTYPE_OPTIONS.safety.map((o) => o.value);
    expect(values).toContain("weapon");
    expect(values).toContain("general");
  });
});

describe("getSubtypeLabel", () => {
  it("returns null when subtype is null/undefined/empty", () => {
    expect(getSubtypeLabel("commendation", null)).toBeNull();
    expect(getSubtypeLabel("commendation", undefined)).toBeNull();
    expect(getSubtypeLabel("commendation", "")).toBeNull();
  });

  it("returns Hebrew label for known subtype", () => {
    expect(getSubtypeLabel("commendation", "fitness")).toBe("כושר");
    expect(getSubtypeLabel("discipline", "smoking")).toBe("עישון");
    expect(getSubtypeLabel("safety", "weapon")).toBe("מטווח");
  });

  it("falls back to raw value for unknown type", () => {
    expect(getSubtypeLabel("unknown", "anything")).toBe("anything");
  });

  it("falls back to raw value for unknown subtype within known type", () => {
    expect(getSubtypeLabel("commendation", "unknown_subtype")).toBe("unknown_subtype");
  });
});
