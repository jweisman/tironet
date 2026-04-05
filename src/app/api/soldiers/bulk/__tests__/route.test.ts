import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    squad: { findMany: vi.fn() },
    platoon: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
    soldier: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    activity: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import {
  createMockRequest,
  mockSessionUser,
  mockAssignment,
} from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockSquadFindMany = vi.mocked(prisma.squad.findMany);
const mockPlatoonFindMany = vi.mocked(prisma.platoon.findMany);
const mockSoldierFindMany = vi.mocked(prisma.soldier.findMany);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockActivityCount = vi.mocked(prisma.activity.count);

// Valid v4 UUIDs for Zod validation
const CYCLE = "00000000-0000-4000-8000-000000000001";
const SQUAD = "00000000-0000-4000-8000-000000000002";
const SQUAD_MINE = "00000000-0000-4000-8000-000000000003";
const PLATOON = "00000000-0000-4000-8000-000000000004";
const COMP = "00000000-0000-4000-8000-000000000005";
const OTHER_CYCLE = "00000000-0000-4000-8000-000000000099";

// Admin users need a cycle assignment (admins are scoped by assignment like everyone else)
const adminAssignment = mockAssignment({
  cycleId: CYCLE,
  role: "company_commander",
  unitType: "company",
  unitId: COMP,
});

/** Set up scope mocks for a company_commander admin so getScopeSquadIds returns [SQUAD] */
function mockAdminScope() {
  mockPlatoonFindMany.mockResolvedValueOnce([{ id: PLATOON }] as never);
  mockSquadFindMany.mockResolvedValueOnce([{ id: SQUAD }] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/soldiers/bulk", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid input (missing soldiers)", async () => {
    mockAuth.mockResolvedValue({ user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }) } as never);
    const req = createMockRequest("POST", "/api/soldiers/bulk", { cycleId: CYCLE });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty soldiers array", async () => {
    mockAuth.mockResolvedValue({ user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }) } as never);
    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE, soldiers: [],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when non-admin has no assignment for cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [] }),
    } as never);
    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when squad is out of scope for squad_commander", async () => {
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "squad_commander",
      unitType: "squad",
      unitId: SQUAD_MINE,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    // Squad exists and belongs to cycle, but not in scope
    mockSquadFindMany.mockResolvedValue([
      {
        id: SQUAD, platoonId: PLATOON,
        platoon: { company: { cycleId: CYCLE } },
      },
    ] as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when squad does not belong to the cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }),
    } as never);

    // getScopeSquadIds for company_commander
    mockAdminScope();
    // Validation query: squad belongs to a different cycle
    mockSquadFindMany.mockResolvedValueOnce([
      {
        id: SQUAD, platoonId: PLATOON,
        platoon: { company: { cycleId: OTHER_CYCLE } },
      },
    ] as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Squad not found in cycle");
  });

  it("returns 403 when platoon_commander's scope excludes the squad", async () => {
    const PLATOON_MINE = "00000000-0000-4000-8000-000000000010";
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "platoon_commander",
      unitType: "platoon",
      unitId: PLATOON_MINE,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    // getScopeSquadIds for platoon_commander returns only SQUAD_MINE
    mockSquadFindMany
      .mockResolvedValueOnce([{ id: SQUAD_MINE }] as never) // scope query
      .mockResolvedValueOnce([                               // validation query
        {
          id: SQUAD, platoonId: PLATOON,
          platoon: { company: { cycleId: CYCLE } },
        },
      ] as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("creates soldiers for platoon_commander within scope", async () => {
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "platoon_commander",
      unitType: "platoon",
      unitId: PLATOON,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    // getScopeSquadIds for platoon_commander
    mockSquadFindMany
      .mockResolvedValueOnce([{ id: SQUAD }] as never) // scope query
      .mockResolvedValueOnce([                          // validation query
        {
          id: SQUAD, platoonId: PLATOON,
          platoon: { company: { cycleId: CYCLE } },
        },
      ] as never);

    mockSoldierFindMany.mockResolvedValue([] as never);
    mockTransaction.mockResolvedValue([] as never);
    mockActivityCount.mockResolvedValue(3 as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("creates soldiers for company_commander within scope", async () => {
    const mockPlatoonFindMany = vi.mocked(prisma.platoon.findMany);
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "company_commander",
      unitType: "company",
      unitId: COMP,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    // getScopeSquadIds for company_commander
    mockPlatoonFindMany.mockResolvedValueOnce([{ id: PLATOON }] as never);
    mockSquadFindMany
      .mockResolvedValueOnce([{ id: SQUAD }] as never) // scope query
      .mockResolvedValueOnce([                          // validation query
        {
          id: SQUAD, platoonId: PLATOON,
          platoon: { company: { cycleId: CYCLE } },
        },
      ] as never);

    mockSoldierFindMany.mockResolvedValue([] as never);
    mockTransaction.mockResolvedValue([] as never);
    mockActivityCount.mockResolvedValue(1 as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [{ squadId: SQUAD, givenName: "A", familyName: "B" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("creates soldiers with idNumber in bulk for admin", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }),
    } as never);

    mockAdminScope();
    mockSquadFindMany.mockResolvedValueOnce([
      {
        id: SQUAD, platoonId: PLATOON,
        platoon: { company: { cycleId: CYCLE } },
      },
    ] as never);

    mockSoldierFindMany.mockResolvedValue([] as never);
    mockTransaction.mockResolvedValue([{ id: "new1" }, { id: "new2" }] as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [
        { squadId: SQUAD, givenName: "Alice", familyName: "A", idNumber: "111" },
        { squadId: SQUAD, givenName: "Bob", familyName: "B", idNumber: null },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify $transaction was called with the soldier creates
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("creates soldiers in bulk and returns 201 for admin", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }),
    } as never);

    mockAdminScope();
    mockSquadFindMany.mockResolvedValueOnce([
      {
        id: SQUAD, platoonId: PLATOON,
        platoon: { company: { cycleId: CYCLE } },
      },
    ] as never);

    mockSoldierFindMany.mockResolvedValue([] as never);
    mockTransaction.mockResolvedValue([{ id: "s1" }, { id: "s2" }] as never);
    mockActivityCount.mockResolvedValue(5 as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [
        { squadId: SQUAD, givenName: "Alice", familyName: "A" },
        { squadId: SQUAD, givenName: "Bob", familyName: "B" },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(2);
    expect(body.updated).toBe(0);
    expect(body.activeActivityCount).toBe(5);
  });

  it("updates existing soldiers matched by idNumber and creates new ones", async () => {
    const EXISTING_SOLDIER_ID = "00000000-0000-4000-8000-000000000020";
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }),
    } as never);

    mockAdminScope();
    mockSquadFindMany.mockResolvedValueOnce([
      {
        id: SQUAD, platoonId: PLATOON,
        platoon: { company: { cycleId: CYCLE } },
      },
    ] as never);

    // Existing soldier with idNumber "111" in scope
    mockSoldierFindMany.mockResolvedValue([
      { id: EXISTING_SOLDIER_ID, idNumber: "111", squadId: SQUAD },
    ] as never);
    mockTransaction.mockResolvedValue([{ id: "new1" }, { id: EXISTING_SOLDIER_ID }] as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [
        { squadId: SQUAD, givenName: "Alice", familyName: "A", idNumber: "999" },
        { squadId: SQUAD, givenName: "Bob", familyName: "B", idNumber: "111" },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.updated).toBe(1);
    // Only newly created soldier IDs returned
    expect(body.soldierIds).toEqual(["new1"]);
  });

  it("does not match soldiers without idNumber for update", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true, cycleAssignments: [adminAssignment] }),
    } as never);

    mockAdminScope();
    mockSquadFindMany.mockResolvedValueOnce([
      {
        id: SQUAD, platoonId: PLATOON,
        platoon: { company: { cycleId: CYCLE } },
      },
    ] as never);

    // No soldiers with non-null idNumbers in payload, so findMany not called with any
    mockSoldierFindMany.mockResolvedValue([] as never);
    mockTransaction.mockResolvedValue([{ id: "new1" }, { id: "new2" }] as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers/bulk", {
      cycleId: CYCLE,
      soldiers: [
        { squadId: SQUAD, givenName: "Alice", familyName: "A", idNumber: null },
        { squadId: SQUAD, givenName: "Bob", familyName: "B" },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(2);
    expect(body.updated).toBe(0);
  });
});
