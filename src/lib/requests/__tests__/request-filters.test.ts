import { describe, it, expect } from "vitest";
import { canActOnRequest } from "../workflow";
import { parseMedicalAppointments, hasUpcomingAppointment } from "../medical-appointments";
import type { RequestStatus, RequestType, Role } from "@/types";

// ---------------------------------------------------------------------------
// These predicates mirror the filters used on the requests list page.
// Open tab:   status === "open"
// Active tab: status === "approved" AND type-specific date criteria
// Mine tab:   assignedRole !== null && canActOnRequest(userRole, assignedRole)
// ---------------------------------------------------------------------------

interface RequestState {
  status: RequestStatus;
  assignedRole: Role | null;
}

function isInOpenTab(r: RequestState): boolean {
  return r.status === "open";
}

interface ActiveRequestState extends RequestState {
  type: RequestType;
  departureAt?: string | null;
  returnAt?: string | null;
  medicalAppointments?: string | null;
}

function isInActiveTab(r: ActiveRequestState, today: string): boolean {
  if (r.status !== "approved") return false;
  if (r.type === "hardship") return true;
  if (r.type === "leave") {
    const dep = r.departureAt?.split("T")[0];
    const ret = r.returnAt?.split("T")[0];
    return (dep != null && dep >= today) || (ret != null && ret >= today);
  }
  if (r.type === "medical") {
    const appts = parseMedicalAppointments(r.medicalAppointments);
    return hasUpcomingAppointment(appts);
  }
  return false;
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

  describe("active tab filters by type-specific date criteria", () => {
    const today = new Date().toISOString().split("T")[0];

    it("hardship approved requests are always active", () => {
      expect(isInActiveTab({ status: "approved", assignedRole: null, type: "hardship" }, today)).toBe(true);
    });

    it("hardship approved pending ack are active", () => {
      expect(isInActiveTab({ status: "approved", assignedRole: "squad_commander", type: "hardship" }, today)).toBe(true);
    });

    it("leave with future departureAt is active", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "leave",
        departureAt: `${futureDate(1)}T08:00:00Z`, returnAt: `${futureDate(3)}T20:00:00Z`,
      }, today)).toBe(true);
    });

    it("leave with past departureAt but future returnAt is active (currently on leave)", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "leave",
        departureAt: `${futureDate(-2)}T08:00:00Z`, returnAt: `${futureDate(1)}T20:00:00Z`,
      }, today)).toBe(true);
    });

    it("leave with both dates in past is not active", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "leave",
        departureAt: `${futureDate(-6)}T08:00:00Z`, returnAt: `${futureDate(-4)}T20:00:00Z`,
      }, today)).toBe(false);
    });

    it("leave with null dates is not active", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "leave",
        departureAt: null, returnAt: null,
      }, today)).toBe(false);
    });

    it("medical with future appointment is active", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "medical",
        medicalAppointments: JSON.stringify([{ id: "a1", date: futureDate(3), place: "Hospital", type: "Checkup" }]),
      }, today)).toBe(true);
    });

    it("medical with all past appointments is not active", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "medical",
        medicalAppointments: JSON.stringify([{ id: "a1", date: futureDate(-6), place: "Hospital", type: "Checkup" }]),
      }, today)).toBe(false);
    });

    it("medical with null appointments is not active", () => {
      expect(isInActiveTab({
        status: "approved", assignedRole: null, type: "medical",
        medicalAppointments: null,
      }, today)).toBe(false);
    });

    it("non-approved requests are never active", () => {
      expect(isInActiveTab({ status: "open", assignedRole: "platoon_commander", type: "hardship" }, today)).toBe(false);
      expect(isInActiveTab({ status: "denied", assignedRole: null, type: "hardship" }, today)).toBe(false);
    });
  });

  describe("denied-pending-ack never appears in open or active tabs", () => {
    const deniedPending = STATES.filter((s) => s.state.status === "denied" && s.state.assignedRole !== null);
    const today = "2026-04-07";

    it.each(deniedPending.map((s) => [s.label, s.state] as const))(
      "%s → not in open, not in active",
      (_label, state) => {
        expect(isInOpenTab(state)).toBe(false);
        // Denied requests are never active regardless of type
        expect(isInActiveTab({ ...state, type: "leave", departureAt: "2099-01-01T00:00:00Z", returnAt: "2099-01-02T00:00:00Z" }, today)).toBe(false);
        expect(isInActiveTab({ ...state, type: "hardship" }, today)).toBe(false);
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

  describe("deputy_company_commander cannot act on any assignments (not in workflow)", () => {
    it.each(STATES.map((s) => [s.label, s.state] as const))("%s", (_label, state) => {
      expect(isInMineTab(state, "deputy_company_commander")).toBe(false);
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

// ---------------------------------------------------------------------------
// Active request sort order
// ---------------------------------------------------------------------------

interface SortableRequest {
  type: RequestType;
  departureAt?: string | null;
  returnAt?: string | null;
  medicalAppointments?: string | null;
  createdAt?: string;
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

/** Mirrors activeRequestSortDate from the requests page. */
function activeRequestSortDate(r: SortableRequest): string {
  if (r.type === "leave") {
    return r.departureAt?.split("T")[0] ?? r.returnAt?.split("T")[0] ?? "9999";
  }
  if (r.type === "medical") {
    const today = new Date().toISOString().split("T")[0];
    const appts = parseMedicalAppointments(r.medicalAppointments);
    const next = appts.find((a) => a.date >= today);
    return next?.date ?? "9999";
  }
  // Hardship: no activity date, sort last
  return "9999";
}

describe("active request sort order", () => {
  it("leave requests sort by departure date, soonest first", () => {
    const a: SortableRequest = { type: "leave", departureAt: `${futureDate(3)}T08:00:00Z`, returnAt: `${futureDate(5)}T20:00:00Z` };
    const b: SortableRequest = { type: "leave", departureAt: `${futureDate(1)}T08:00:00Z`, returnAt: `${futureDate(2)}T20:00:00Z` };
    const sorted = [a, b].sort((x, y) => activeRequestSortDate(x).localeCompare(activeRequestSortDate(y)));
    expect(sorted).toEqual([b, a]);
  });

  it("leave with null departureAt falls back to returnAt", () => {
    const ret = futureDate(5);
    const a: SortableRequest = { type: "leave", departureAt: null, returnAt: `${ret}T20:00:00Z` };
    expect(activeRequestSortDate(a)).toBe(ret);
  });

  it("medical requests sort by earliest upcoming appointment", () => {
    const a: SortableRequest = {
      type: "medical",
      medicalAppointments: JSON.stringify([
        { id: "1", date: futureDate(5), place: "A", type: "X" },
        { id: "2", date: futureDate(10), place: "B", type: "Y" },
      ]),
    };
    const b: SortableRequest = {
      type: "medical",
      medicalAppointments: JSON.stringify([
        { id: "3", date: futureDate(1), place: "C", type: "Z" },
      ]),
    };
    const sorted = [a, b].sort((x, y) => activeRequestSortDate(x).localeCompare(activeRequestSortDate(y)));
    expect(sorted).toEqual([b, a]);
  });

  it("hardship requests always sort last", () => {
    const a: SortableRequest = { type: "hardship", createdAt: "2026-04-05T10:00:00Z" };
    const b: SortableRequest = { type: "hardship", createdAt: "2026-04-02T10:00:00Z" };
    // Both get "9999", so relative order is stable (no reordering)
    expect(activeRequestSortDate(a)).toBe("9999");
    expect(activeRequestSortDate(b)).toBe("9999");
  });

  it("mixed types: leave and medical sort by date, hardship sorts last", () => {
    const leave: SortableRequest = { type: "leave", departureAt: `${futureDate(5)}T08:00:00Z` };
    const medical: SortableRequest = {
      type: "medical",
      medicalAppointments: JSON.stringify([{ id: "1", date: futureDate(2), place: "A", type: "X" }]),
    };
    const hardship: SortableRequest = { type: "hardship", createdAt: "2026-04-01T10:00:00Z" };
    const sorted = [hardship, leave, medical].sort((x, y) =>
      activeRequestSortDate(x).localeCompare(activeRequestSortDate(y)),
    );
    expect(sorted).toEqual([medical, leave, hardship]);
  });
});
