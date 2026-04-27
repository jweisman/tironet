import { describe, it, expect } from "vitest";
import {
  effectiveRole,
  rolesInvitableBy,
  canInviteRole,
  RANKS,
  ROLE_LABELS,
  UNIT_TYPE_FOR_ROLE,
} from "../permissions";

describe("effectiveRole", () => {
  it("maps deputy_company_commander to company_commander", () => {
    expect(effectiveRole("deputy_company_commander")).toBe("company_commander");
  });

  it("maps platoon_sergeant to platoon_commander", () => {
    expect(effectiveRole("platoon_sergeant")).toBe("platoon_commander");
  });

  it("passes instructor through unchanged", () => {
    expect(effectiveRole("instructor")).toBe("instructor");
  });

  it("passes company_medic through unchanged", () => {
    expect(effectiveRole("company_medic")).toBe("company_medic");
  });

  it("passes hardship_coordinator through unchanged", () => {
    expect(effectiveRole("hardship_coordinator")).toBe("hardship_coordinator");
  });

  it("passes base roles through unchanged", () => {
    expect(effectiveRole("company_commander")).toBe("company_commander");
    expect(effectiveRole("platoon_commander")).toBe("platoon_commander");
    expect(effectiveRole("squad_commander")).toBe("squad_commander");
  });
});

describe("rolesInvitableBy", () => {
  it("admin can invite all roles", () => {
    const roles = rolesInvitableBy(null, true);
    expect(roles).toContain("company_commander");
    expect(roles).toContain("deputy_company_commander");
    expect(roles).toContain("platoon_commander");
    expect(roles).toContain("platoon_sergeant");
    expect(roles).toContain("squad_commander");
    expect(roles).toContain("instructor");
    expect(roles).toContain("company_medic");
    expect(roles).toContain("hardship_coordinator");
    expect(roles).toHaveLength(8);
  });

  it("company_commander can invite lower-ranked and company-level roles", () => {
    const roles = rolesInvitableBy("company_commander", false);
    expect(roles).toContain("platoon_commander");
    expect(roles).toContain("platoon_sergeant");
    expect(roles).toContain("squad_commander");
    expect(roles).toContain("instructor");
    expect(roles).toContain("company_medic");
    expect(roles).toContain("hardship_coordinator");
    expect(roles).not.toContain("company_commander");
    expect(roles).not.toContain("deputy_company_commander");
  });

  it("deputy_company_commander can invite same roles as company_commander", () => {
    const roles = rolesInvitableBy("deputy_company_commander", false);
    expect(roles).toContain("platoon_commander");
    expect(roles).toContain("platoon_sergeant");
    expect(roles).toContain("squad_commander");
    expect(roles).toContain("instructor");
    expect(roles).toContain("company_medic");
    expect(roles).toContain("hardship_coordinator");
    expect(roles).not.toContain("company_commander");
    expect(roles).not.toContain("deputy_company_commander");
  });

  it("platoon_commander can invite squad_commander and platoon_sergeant", () => {
    const roles = rolesInvitableBy("platoon_commander", false);
    expect(roles).toContain("squad_commander");
    expect(roles).toContain("platoon_sergeant");
    expect(roles).toHaveLength(2);
  });

  it("platoon_sergeant can invite squad_commander and platoon_sergeant", () => {
    const roles = rolesInvitableBy("platoon_sergeant", false);
    expect(roles).toContain("squad_commander");
    expect(roles).toContain("platoon_sergeant");
    expect(roles).toHaveLength(2);
  });

  it("squad_commander cannot invite anyone", () => {
    const roles = rolesInvitableBy("squad_commander", false);
    expect(roles).toHaveLength(0);
  });

  it("null role (non-commander) cannot invite anyone", () => {
    const roles = rolesInvitableBy(null, false);
    expect(roles).toHaveLength(0);
  });
});

describe("canInviteRole", () => {
  it("company_commander can invite platoon_commander", () => {
    expect(canInviteRole("company_commander", "platoon_commander")).toBe(true);
  });

  it("company_commander can invite squad_commander", () => {
    expect(canInviteRole("company_commander", "squad_commander")).toBe(true);
  });

  it("company_commander cannot invite company_commander", () => {
    expect(canInviteRole("company_commander", "company_commander")).toBe(false);
  });

  it("platoon_commander can invite squad_commander", () => {
    expect(canInviteRole("platoon_commander", "squad_commander")).toBe(true);
  });

  it("platoon_commander can invite platoon_sergeant", () => {
    expect(canInviteRole("platoon_commander", "platoon_sergeant")).toBe(true);
  });

  it("platoon_commander cannot invite platoon_commander", () => {
    expect(canInviteRole("platoon_commander", "platoon_commander")).toBe(false);
  });

  it("squad_commander cannot invite anyone", () => {
    expect(canInviteRole("squad_commander", "squad_commander")).toBe(false);
    expect(canInviteRole("squad_commander", "platoon_commander")).toBe(false);
    expect(canInviteRole("squad_commander", "company_commander")).toBe(false);
  });

  it("instructor can invite lower-ranked roles (rank 3)", () => {
    expect(canInviteRole("instructor", "squad_commander")).toBe(true);
    expect(canInviteRole("instructor", "platoon_commander")).toBe(true);
    expect(canInviteRole("instructor", "instructor")).toBe(false);
    expect(canInviteRole("instructor", "company_commander")).toBe(false);
  });

  it("company_medic can invite lower-ranked roles (rank 3)", () => {
    expect(canInviteRole("company_medic", "squad_commander")).toBe(true);
    expect(canInviteRole("company_medic", "platoon_commander")).toBe(true);
    expect(canInviteRole("company_medic", "company_medic")).toBe(false);
  });

  it("company_commander can invite company-level roles", () => {
    expect(canInviteRole("company_commander", "instructor")).toBe(true);
    expect(canInviteRole("company_commander", "company_medic")).toBe(true);
    expect(canInviteRole("company_commander", "hardship_coordinator")).toBe(true);
  });

  it("deputy_company_commander can invite company-level roles", () => {
    expect(canInviteRole("deputy_company_commander", "instructor")).toBe(true);
    expect(canInviteRole("deputy_company_commander", "company_medic")).toBe(true);
    expect(canInviteRole("deputy_company_commander", "hardship_coordinator")).toBe(true);
  });
});

describe("constants", () => {
  it("RANKS has expected military ranks", () => {
    expect(RANKS).toContain("טוראי");
    expect(RANKS).toContain("סגן");
    expect(RANKS.length).toBeGreaterThan(0);
  });

  it("ROLE_LABELS maps all roles", () => {
    expect(ROLE_LABELS.company_commander).toBe('מ"פ');
    expect(ROLE_LABELS.deputy_company_commander).toBe('סמ"פ');
    expect(ROLE_LABELS.platoon_commander).toBe('מ"מ');
    expect(ROLE_LABELS.platoon_sergeant).toBe('סמ"ח');
    expect(ROLE_LABELS.squad_commander).toBe('מ"כ');
    expect(ROLE_LABELS.instructor).toBe("מדריך");
    expect(ROLE_LABELS.company_medic).toBe('חופ"ל');
    expect(ROLE_LABELS.hardship_coordinator).toBe('מש"קית ת"ש');
  });

  it("UNIT_TYPE_FOR_ROLE maps roles to unit types", () => {
    expect(UNIT_TYPE_FOR_ROLE.company_commander).toBe("company");
    expect(UNIT_TYPE_FOR_ROLE.deputy_company_commander).toBe("company");
    expect(UNIT_TYPE_FOR_ROLE.platoon_commander).toBe("platoon");
    expect(UNIT_TYPE_FOR_ROLE.platoon_sergeant).toBe("platoon");
    expect(UNIT_TYPE_FOR_ROLE.squad_commander).toBe("squad");
    expect(UNIT_TYPE_FOR_ROLE.instructor).toBe("company");
    expect(UNIT_TYPE_FOR_ROLE.company_medic).toBe("company");
    expect(UNIT_TYPE_FOR_ROLE.hardship_coordinator).toBe("company");
  });
});
