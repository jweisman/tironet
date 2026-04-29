import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    squad: { findMany: vi.fn(), findUnique: vi.fn() },
    platoon: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
    soldier: { create: vi.fn() },
    activity: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET, POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import {
  createMockRequest,
  mockSessionUser,
  mockAssignment,
} from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockSquadFindMany = vi.mocked(prisma.squad.findMany);
const mockSquadFindUnique = vi.mocked(prisma.squad.findUnique);
const mockSoldierCreate = vi.mocked(prisma.soldier.create);
const mockActivityCount = vi.mocked(prisma.activity.count);
const mockActivityFindMany = vi.mocked(prisma.activity.findMany);

// Valid v4 UUIDs for Zod validation
const CYCLE = "00000000-0000-4000-8000-000000000001";
const SQUAD = "00000000-0000-4000-8000-000000000002";
const SQUAD_OTHER = "00000000-0000-4000-8000-000000000003";
const PLATOON = "00000000-0000-4000-8000-000000000004";
const COMP = "00000000-0000-4000-8000-000000000005";
const OTHER_CYCLE = "00000000-0000-4000-8000-000000000099";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/soldiers
// ---------------------------------------------------------------------------
describe("GET /api/soldiers", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when cycleId is missing", async () => {
    mockAuth.mockResolvedValue({ user: mockSessionUser() } as never);
    const req = createMockRequest("GET", "/api/soldiers");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user has no assignment for the cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [] }),
    } as never);
    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns soldiers for squad_commander (only their squad)", async () => {
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "squad_commander",
      unitType: "squad",
      unitId: SQUAD,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    mockSquadFindMany.mockResolvedValue([
      {
        id: SQUAD,
        name: "Squad A",
        platoonId: PLATOON,
        platoon: { id: PLATOON, name: "Platoon 1" },
        soldiers: [
          {
            id: "s1",
            givenName: "John",
            familyName: "Doe",
            rank: null,
            status: "active",
            profileImage: null,
            squad: { platoonId: PLATOON },
          },
        ],
      },
    ] as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("squad_commander");
    expect(body.squads).toHaveLength(1);
    expect(body.squads[0].soldiers[0].givenName).toBe("John");
  });

  it("scopes admin by cycle assignment, not isAdmin flag", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        isAdmin: true,
        cycleAssignments: [mockAssignment({
          cycleId: CYCLE,
          role: "company_commander",
          unitType: "company",
          unitId: COMP,
        })],
      }),
    } as never);

    vi.mocked(prisma.platoon.findMany).mockResolvedValue([{ id: PLATOON }] as never);
    mockSquadFindMany
      .mockResolvedValueOnce([{ id: SQUAD }] as never)
      .mockResolvedValueOnce([] as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("company_commander");
  });
});

// ---------------------------------------------------------------------------
// POST /api/soldiers
// ---------------------------------------------------------------------------
describe("POST /api/soldiers", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid input (missing required fields)", async () => {
    mockAuth.mockResolvedValue({ user: mockSessionUser({ isAdmin: true }) } as never);
    const req = createMockRequest("POST", "/api/soldiers", { cycleId: CYCLE });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when non-admin user has no assignment for cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [] }),
    } as never);
    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when squad is not in scope for squad_commander", async () => {
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "squad_commander",
      unitType: "squad",
      unitId: SQUAD_OTHER,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when squad does not belong to the cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({
          cycleId: CYCLE, role: "platoon_commander", unitType: "platoon", unitId: PLATOON,
        })],
      }),
    } as never);

    mockSquadFindMany.mockResolvedValue([{ id: SQUAD }] as never);
    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: OTHER_CYCLE } },
    } as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Squad not found in cycle");
  });

  it("creates a soldier for platoon_commander within their platoon", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({
          cycleId: CYCLE, role: "platoon_commander", unitType: "platoon", unitId: PLATOON,
        })],
      }),
    } as never);

    mockSquadFindMany.mockResolvedValue([{ id: SQUAD }] as never);
    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);

    const createdSoldier = {
      id: "soldier-new", cycleId: CYCLE, squadId: SQUAD,
      givenName: "Jane", familyName: "Doe", rank: null, status: "active", profileImage: null,
    };
    mockSoldierCreate.mockResolvedValue(createdSoldier as never);
    mockActivityCount.mockResolvedValue(3 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.soldier.givenName).toBe("Jane");
    expect(body.activeActivityCount).toBe(3);
  });

  it("creates a soldier with idNumber", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({
          cycleId: CYCLE, role: "platoon_commander", unitType: "platoon", unitId: PLATOON,
        })],
      }),
    } as never);

    mockSquadFindMany.mockResolvedValue([{ id: SQUAD }] as never);
    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);

    const createdSoldier = {
      id: "soldier-new", cycleId: CYCLE, squadId: SQUAD,
      givenName: "Jane", familyName: "Doe", idNumber: "1234567",
      rank: null, status: "active", profileImage: null,
    };
    mockSoldierCreate.mockResolvedValue(createdSoldier as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe", idNumber: "1234567",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockSoldierCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ idNumber: "1234567" }),
    });
  });

  it("creates a soldier with dateOfBirth", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({
          cycleId: CYCLE, role: "platoon_commander", unitType: "platoon", unitId: PLATOON,
        })],
      }),
    } as never);

    mockSquadFindMany.mockResolvedValue([{ id: SQUAD }] as never);
    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);

    mockSoldierCreate.mockResolvedValue({ id: "soldier-new" } as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
      dateOfBirth: "2007-05-15",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockSoldierCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ dateOfBirth: new Date("2007-05-15") }),
    });
  });

  it("creates a soldier with null dateOfBirth when not provided", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({
          cycleId: CYCLE, role: "platoon_commander", unitType: "platoon", unitId: PLATOON,
        })],
      }),
    } as never);

    mockSquadFindMany.mockResolvedValue([{ id: SQUAD }] as never);
    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);

    mockSoldierCreate.mockResolvedValue({ id: "soldier-new" } as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockSoldierCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ dateOfBirth: null }),
    });
  });

  it("creates a soldier for squad_commander within their squad", async () => {
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "squad_commander",
      unitType: "squad",
      unitId: SQUAD,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);
    mockSoldierCreate.mockResolvedValue({ id: "soldier-new" } as never);
    mockActivityCount.mockResolvedValue(0 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("creates a soldier for platoon_commander with squad in their platoon", async () => {
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
    mockSquadFindMany.mockResolvedValueOnce([{ id: SQUAD }] as never);

    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);
    mockSoldierCreate.mockResolvedValue({ id: "soldier-new" } as never);
    mockActivityCount.mockResolvedValue(2 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("creates a soldier for company_commander with squad in their company", async () => {
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
    vi.mocked(prisma.platoon.findMany).mockResolvedValueOnce([{ id: PLATOON }] as never);
    mockSquadFindMany.mockResolvedValueOnce([{ id: SQUAD }] as never);

    mockSquadFindUnique.mockResolvedValue({
      id: SQUAD, platoonId: PLATOON,
      platoon: { companyId: COMP, company: { cycleId: CYCLE } },
    } as never);
    mockSoldierCreate.mockResolvedValue({ id: "soldier-new" } as never);
    mockActivityCount.mockResolvedValue(1 as never);

    const req = createMockRequest("POST", "/api/soldiers", {
      cycleId: CYCLE, squadId: SQUAD, givenName: "Jane", familyName: "Doe",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// GET /api/soldiers — gap count computation
// ---------------------------------------------------------------------------
describe("GET /api/soldiers — gap counts", () => {
  it("computes gap counts based on missing/failed reports", async () => {
    const assignment = mockAssignment({
      cycleId: CYCLE,
      role: "squad_commander",
      unitType: "squad",
      unitId: SQUAD,
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    mockSquadFindMany.mockResolvedValue([
      {
        id: SQUAD,
        name: "Squad A",
        platoonId: PLATOON,
        platoon: { id: PLATOON, name: "Platoon 1" },
        soldiers: [
          {
            id: "s1", givenName: "John", familyName: "Doe",
            rank: null, status: "active", profileImage: null,
            squad: { platoonId: PLATOON },
          },
          {
            id: "s2", givenName: "Jane", familyName: "Smith",
            rank: null, status: "active", profileImage: null,
            squad: { platoonId: PLATOON },
          },
        ],
      },
    ] as never);

    // Two active required activities in the platoon
    mockActivityFindMany.mockResolvedValue([
      {
        id: "act-1",
        platoonId: PLATOON,
        reports: [
          { soldierId: "s1", result: "completed", failed: false },
          { soldierId: "s2", result: "skipped", failed: false },
        ],
      },
      {
        id: "act-2",
        platoonId: PLATOON,
        reports: [
          { soldierId: "s1", result: "completed", failed: false },
          // s2 has no report for act-2
        ],
      },
    ] as never);

    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    // s1: act-1 passed, act-2 passed → 0 gaps
    expect(body.squads[0].soldiers[0].gapCount).toBe(0);
    // s2: act-1 failed (counts as gap), act-2 missing (counts as gap) → 2 gaps
    expect(body.squads[0].soldiers[1].gapCount).toBe(2);
  });

  it("returns soldiers for platoon_commander (squads in their platoon)", async () => {
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
      .mockResolvedValueOnce([                          // main query
        {
          id: SQUAD, name: "S1", platoonId: PLATOON,
          platoon: { id: PLATOON, name: "P1" },
          soldiers: [],
        },
      ] as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("platoon_commander");
  });

  it("returns soldiers for company_commander (squads in their company)", async () => {
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
    vi.mocked(prisma.platoon.findMany).mockResolvedValueOnce([{ id: PLATOON }] as never);
    mockSquadFindMany
      .mockResolvedValueOnce([{ id: SQUAD }] as never) // scope query
      .mockResolvedValueOnce([                          // main query
        {
          id: SQUAD, name: "S1", platoonId: PLATOON,
          platoon: { id: PLATOON, name: "P1" },
          soldiers: [],
        },
      ] as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers", undefined, { cycleId: CYCLE });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("company_commander");
  });
});
