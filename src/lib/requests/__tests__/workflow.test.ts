import { describe, it, expect } from "vitest";
import { getNextState, canActOnRequest, getAvailableActions } from "../workflow";

// ---------------------------------------------------------------------------
// getNextState
// ---------------------------------------------------------------------------
describe("getNextState", () => {
  describe("platoon_commander actions", () => {
    it("approve leave → approved, sent to squad_commander", () => {
      const result = getNextState("open", "platoon_commander", "approve", "leave");
      expect(result).toEqual({ newStatus: "approved", newAssignedRole: "squad_commander" });
    });

    it("approve medical → approved, sent to squad_commander", () => {
      const result = getNextState("open", "platoon_commander", "approve", "medical");
      expect(result).toEqual({ newStatus: "approved", newAssignedRole: "squad_commander" });
    });

    it("approve hardship → approved, sent to squad_commander", () => {
      const result = getNextState("open", "platoon_commander", "approve", "hardship");
      expect(result).toEqual({ newStatus: "approved", newAssignedRole: "squad_commander" });
    });

    it("deny open → denied, sent to squad_commander", () => {
      const result = getNextState("open", "platoon_commander", "deny", "leave");
      expect(result).toEqual({ newStatus: "denied", newAssignedRole: "squad_commander" });
    });

    it("approve non-open → returns null", () => {
      const result = getNextState("approved", "platoon_commander", "approve", "leave");
      expect(result).toBeNull();
    });

    it("acknowledge → returns null (platoon_commander no longer acknowledges)", () => {
      const result = getNextState("approved", "platoon_commander", "acknowledge", "leave");
      expect(result).toBeNull();
    });
  });

  describe("squad_commander actions", () => {
    it("acknowledge approved → closes workflow (null assignedRole)", () => {
      const result = getNextState("approved", "squad_commander", "acknowledge", "leave");
      expect(result).toEqual({ newStatus: "approved", newAssignedRole: null });
    });

    it("acknowledge denied → closes workflow (null assignedRole)", () => {
      const result = getNextState("denied", "squad_commander", "acknowledge", "leave");
      expect(result).toEqual({ newStatus: "denied", newAssignedRole: null });
    });

    it("approve open → returns null (squad commander cannot approve)", () => {
      const result = getNextState("open", "squad_commander", "approve", "leave");
      expect(result).toBeNull();
    });
  });

  describe("company_commander — no longer in workflow", () => {
    it("approve open → returns null", () => {
      const result = getNextState("open", "company_commander", "approve", "leave");
      expect(result).toBeNull();
    });

    it("deny open → returns null", () => {
      const result = getNextState("open", "company_commander", "deny", "leave");
      expect(result).toBeNull();
    });
  });

  describe("invalid transitions", () => {
    it("returns null for unknown role", () => {
      const result = getNextState("open", "admin" as never, "approve", "leave");
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// canActOnRequest
// ---------------------------------------------------------------------------
describe("canActOnRequest", () => {
  it("returns true when user role matches assigned role", () => {
    expect(canActOnRequest("platoon_commander", "platoon_commander")).toBe(true);
  });

  it("returns false when roles do not match", () => {
    expect(canActOnRequest("squad_commander", "platoon_commander")).toBe(false);
  });

  it("deputy_company_commander cannot act on company_commander assignments", () => {
    expect(canActOnRequest("deputy_company_commander", "company_commander")).toBe(false);
  });

  it("platoon_sergeant cannot act on platoon_commander assignments", () => {
    expect(canActOnRequest("platoon_sergeant", "platoon_commander")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAvailableActions
// ---------------------------------------------------------------------------
describe("getAvailableActions", () => {
  it("returns approve+deny for platoon_commander on open leave request", () => {
    const actions = getAvailableActions("open", "platoon_commander", "platoon_commander", "leave");
    expect(actions).toContain("approve");
    expect(actions).toContain("deny");
    expect(actions).not.toContain("acknowledge");
  });

  it("returns empty for company_commander on open request (no longer in workflow)", () => {
    const actions = getAvailableActions("open", "company_commander", "company_commander", "leave");
    expect(actions).toEqual([]);
  });

  it("returns acknowledge for squad_commander on approved request", () => {
    const actions = getAvailableActions("approved", "squad_commander", "squad_commander", "leave");
    expect(actions).toEqual(["acknowledge"]);
  });

  it("returns empty for platoon_commander on approved request (no longer acknowledges)", () => {
    const actions = getAvailableActions("approved", "platoon_commander", "platoon_commander", "leave");
    expect(actions).toEqual([]);
  });

  it("returns empty array when user role does not match assigned role", () => {
    const actions = getAvailableActions("open", "platoon_commander", "squad_commander", "leave");
    expect(actions).toEqual([]);
  });

  it("returns empty array when assignedRole is null", () => {
    const actions = getAvailableActions("approved", null, "squad_commander", "leave");
    expect(actions).toEqual([]);
  });

  it("returns empty array for squad_commander on open request (cannot approve)", () => {
    const actions = getAvailableActions("open", "squad_commander", "squad_commander", "leave");
    expect(actions).toEqual([]);
  });

  it("platoon_sergeant gets no actions for platoon_commander assignment", () => {
    const actions = getAvailableActions("open", "platoon_commander", "platoon_sergeant", "leave");
    expect(actions).toEqual([]);
  });
});
