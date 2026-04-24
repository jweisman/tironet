import { describe, it, expect } from "vitest";
import { canEditRequest, canDeleteRequest } from "../permissions";
import type { RequestType, Role } from "@/types";

describe("canEditRequest", () => {
  const editCases: [Role, RequestType, boolean][] = [
    // Platoon commander and sergeant can edit all types
    ["platoon_commander", "leave", true],
    ["platoon_commander", "medical", true],
    ["platoon_commander", "hardship", true],
    ["platoon_sergeant", "leave", true],
    ["platoon_sergeant", "medical", true],
    ["platoon_sergeant", "hardship", true],
    // Company commander and deputy can edit all types
    ["company_commander", "leave", true],
    ["company_commander", "medical", true],
    ["company_commander", "hardship", true],
    ["deputy_company_commander", "leave", true],
    ["deputy_company_commander", "medical", true],
    ["deputy_company_commander", "hardship", true],
    // Company medic: only medical
    ["company_medic", "medical", true],
    ["company_medic", "leave", false],
    ["company_medic", "hardship", false],
    // Hardship coordinator: only hardship
    ["hardship_coordinator", "hardship", true],
    ["hardship_coordinator", "leave", false],
    ["hardship_coordinator", "medical", false],
    // Squad commander and instructor: cannot edit
    ["squad_commander", "leave", false],
    ["squad_commander", "medical", false],
    ["squad_commander", "hardship", false],
    ["instructor", "leave", false],
    ["instructor", "medical", false],
    ["instructor", "hardship", false],
  ];

  it.each(editCases)("%s editing %s request → %s", (role, type, expected) => {
    expect(canEditRequest(role, type)).toBe(expected);
  });
});

describe("canDeleteRequest", () => {
  it("allows delete when assignedRole is not null and role has edit permission", () => {
    expect(canDeleteRequest("platoon_commander", "leave", "platoon_commander")).toBe(true);
  });

  it("blocks delete when assignedRole is null (completed request)", () => {
    expect(canDeleteRequest("platoon_commander", "leave", null)).toBe(false);
  });

  it("blocks delete when role lacks edit permission", () => {
    expect(canDeleteRequest("squad_commander", "leave", "platoon_commander")).toBe(false);
  });

  it("allows company_medic to delete open medical request", () => {
    expect(canDeleteRequest("company_medic", "medical", "platoon_commander")).toBe(true);
  });

  it("blocks company_medic from deleting open leave request", () => {
    expect(canDeleteRequest("company_medic", "leave", "platoon_commander")).toBe(false);
  });
});
