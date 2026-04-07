import { describe, it, expect } from "vitest";
import { canActOnRequest } from "../workflow";
import type { RequestStatus, Role } from "@/types";

// ---------------------------------------------------------------------------
// These predicates mirror the filters used on the requests list page.
// Open tab:     status === "open"
// Approved tab: status === "approved"
// Mine tab:     assignedRole !== null && canActOnRequest(userRole, assignedRole)
// ---------------------------------------------------------------------------

interface RequestState {
  status: RequestStatus;
  assignedRole: Role | null;
}

function isInOpenTab(r: RequestState): boolean {
  return r.status === "open";
}

function isInApprovedTab(r: RequestState): boolean {
  return r.status === "approved";
}

function isInMineTab(r: RequestState, userRole: Role): boolean {
  return r.assignedRole !== null && canActOnRequest(userRole, r.assignedRole);
}

// ---------------------------------------------------------------------------
// All possible workflow states a request can be in
// ---------------------------------------------------------------------------

const STATES: { label: string; state: RequestState }[] = [
  { label: "open → platoon_commander", state: { status: "open", assignedRole: "platoon_commander" } },
  { label: "open → company_commander", state: { status: "open", assignedRole: "company_commander" } },
  { label: "approved → platoon_commander (ack)", state: { status: "approved", assignedRole: "platoon_commander" } },
  { label: "approved → squad_commander (ack)", state: { status: "approved", assignedRole: "squad_commander" } },
  { label: "denied → platoon_commander (ack)", state: { status: "denied", assignedRole: "platoon_commander" } },
  { label: "denied → squad_commander (ack)", state: { status: "denied", assignedRole: "squad_commander" } },
  { label: "approved → done", state: { status: "approved", assignedRole: null } },
  { label: "denied → done", state: { status: "denied", assignedRole: null } },
];

// ---------------------------------------------------------------------------
// Tab classification tests
// ---------------------------------------------------------------------------

describe("request tab classification", () => {
  describe("open tab includes only status=open", () => {
    it.each([
      ["open → platoon_commander", true],
      ["open → company_commander", true],
      ["approved → platoon_commander (ack)", false],
      ["approved → squad_commander (ack)", false],
      ["denied → platoon_commander (ack)", false],
      ["denied → squad_commander (ack)", false],
      ["approved → done", false],
      ["denied → done", false],
    ])("%s → inOpenTab=%s", (label, expected) => {
      const { state } = STATES.find((s) => s.label === label)!;
      expect(isInOpenTab(state)).toBe(expected);
    });
  });

  describe("approved tab includes only status=approved", () => {
    it.each([
      ["open → platoon_commander", false],
      ["open → company_commander", false],
      ["approved → platoon_commander (ack)", true],
      ["approved → squad_commander (ack)", true],
      ["denied → platoon_commander (ack)", false],
      ["denied → squad_commander (ack)", false],
      ["approved → done", true],
      ["denied → done", false],
    ])("%s → inApprovedTab=%s", (label, expected) => {
      const { state } = STATES.find((s) => s.label === label)!;
      expect(isInApprovedTab(state)).toBe(expected);
    });
  });

  describe("denied-pending-ack never appears in open or approved tabs", () => {
    const deniedPending = STATES.filter((s) => s.state.status === "denied" && s.state.assignedRole !== null);

    it.each(deniedPending.map((s) => [s.label, s.state] as const))(
      "%s → not in open, not in approved",
      (_label, state) => {
        expect(isInOpenTab(state)).toBe(false);
        expect(isInApprovedTab(state)).toBe(false);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// "Mine" tab classification per role
// ---------------------------------------------------------------------------

describe("mine tab classification", () => {
  describe("squad_commander sees only requests assigned to squad_commander", () => {
    it.each(STATES.map((s) => [s.label, s.state] as const))("%s", (_label, state) => {
      const expected = state.assignedRole === "squad_commander";
      expect(isInMineTab(state, "squad_commander")).toBe(expected);
    });
  });

  describe("platoon_commander sees only requests assigned to platoon_commander", () => {
    it.each(STATES.map((s) => [s.label, s.state] as const))("%s", (_label, state) => {
      const expected = state.assignedRole === "platoon_commander";
      expect(isInMineTab(state, "platoon_commander")).toBe(expected);
    });
  });

  describe("company_commander sees only requests assigned to company_commander", () => {
    it.each(STATES.map((s) => [s.label, s.state] as const))("%s", (_label, state) => {
      const expected = state.assignedRole === "company_commander";
      expect(isInMineTab(state, "company_commander")).toBe(expected);
    });
  });

  describe("deputy_company_commander can act on company_commander assignments", () => {
    it.each(STATES.map((s) => [s.label, s.state] as const))("%s", (_label, state) => {
      const expected = state.assignedRole === "company_commander";
      expect(isInMineTab(state, "deputy_company_commander")).toBe(expected);
    });
  });

  describe("platoon_sergeant cannot act on platoon_commander assignments", () => {
    it.each(STATES.map((s) => [s.label, s.state] as const))("%s", (_label, state) => {
      // platoon_sergeant does not match any assignedRole per matchesAssignment
      expect(isInMineTab(state, "platoon_sergeant")).toBe(false);
    });
  });

  describe("completed requests (assignedRole=null) never appear in mine", () => {
    const completed = STATES.filter((s) => s.state.assignedRole === null);
    const allRoles: Role[] = [
      "squad_commander",
      "platoon_commander",
      "company_commander",
      "deputy_company_commander",
      "platoon_sergeant",
    ];

    it.each(
      completed.flatMap((s) => allRoles.map((r) => [s.label, r] as const)),
    )("%s — %s → false", (label, role) => {
      const { state } = STATES.find((s) => s.label === label)!;
      expect(isInMineTab(state, role)).toBe(false);
    });
  });
});
