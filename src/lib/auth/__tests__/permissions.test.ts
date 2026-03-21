import { describe, it, expect } from "vitest";
import {
  rolesInvitableBy,
  canInviteRole,
  RANKS,
  ROLE_LABELS,
  UNIT_TYPE_FOR_ROLE,
} from "../permissions";

describe("rolesInvitableBy", () => {
  it("admin can invite all roles", () => {
    const roles = rolesInvitableBy(null, true);
    expect(roles).toContain("company_commander");
    expect(roles).toContain("platoon_commander");
    expect(roles).toContain("squad_commander");
    expect(roles).toHaveLength(3);
  });

  it("company_commander can invite platoon_commander and squad_commander", () => {
    const roles = rolesInvitableBy("company_commander", false);
    expect(roles).toContain("platoon_commander");
    expect(roles).toContain("squad_commander");
    expect(roles).not.toContain("company_commander");
  });

  it("platoon_commander can invite squad_commander only", () => {
    const roles = rolesInvitableBy("platoon_commander", false);
    expect(roles).toEqual(["squad_commander"]);
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

  it("platoon_commander cannot invite platoon_commander", () => {
    expect(canInviteRole("platoon_commander", "platoon_commander")).toBe(false);
  });

  it("squad_commander cannot invite anyone", () => {
    expect(canInviteRole("squad_commander", "squad_commander")).toBe(false);
    expect(canInviteRole("squad_commander", "platoon_commander")).toBe(false);
    expect(canInviteRole("squad_commander", "company_commander")).toBe(false);
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
    expect(ROLE_LABELS.platoon_commander).toBe('מ"מ');
    expect(ROLE_LABELS.squad_commander).toBe('מ"כ');
  });

  it("UNIT_TYPE_FOR_ROLE maps roles to unit types", () => {
    expect(UNIT_TYPE_FOR_ROLE.company_commander).toBe("company");
    expect(UNIT_TYPE_FOR_ROLE.platoon_commander).toBe("platoon");
    expect(UNIT_TYPE_FOR_ROLE.squad_commander).toBe("squad");
  });
});
