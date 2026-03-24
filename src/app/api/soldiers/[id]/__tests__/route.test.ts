import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    soldier: { findUnique: vi.fn(), update: vi.fn() },
    squad: { findUnique: vi.fn() },
    activity: { findMany: vi.fn() },
    activityReport: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET, PATCH } from "../route";
import { POST as markNaPost } from "../mark-na/route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import {
  createMockRequest,
  mockSessionUser,
  mockAssignment,
} from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockSoldierFindUnique = vi.mocked(prisma.soldier.findUnique);
const mockSoldierUpdate = vi.mocked(prisma.soldier.update);
const mockSquadFindUnique = vi.mocked(prisma.squad.findUnique);
const mockActivityFindMany = vi.mocked(prisma.activity.findMany);
const mockReportFindMany = vi.mocked(prisma.activityReport.findMany);
const mockReportCreateMany = vi.mocked(prisma.activityReport.createMany);

beforeEach(() => {
  vi.clearAllMocks();
});

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// GET /api/soldiers/[id]
// ---------------------------------------------------------------------------
describe("GET /api/soldiers/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when soldier not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no assignment for soldier's cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [] }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      squad: {
        id: "squad-1",
        name: "A",
        platoonId: "platoon-1",
        platoon: { id: "platoon-1", name: "P1" },
      },
      activityReports: [],
    } as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when squad is not in scope for squad_commander", async () => {
    const assignment = mockAssignment({
      role: "squad_commander",
      unitType: "squad",
      unitId: "squad-other",
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    mockSoldierFindUnique.mockResolvedValue({
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      squad: {
        id: "squad-1",
        name: "A",
        platoonId: "platoon-1",
        platoon: { id: "platoon-1", name: "P1" },
      },
      activityReports: [],
    } as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(403);
  });

  it("returns soldier details for admin", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);

    const soldier = {
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      givenName: "John",
      familyName: "Doe",
      rank: null,
      status: "active",
      profileImage: null,
      squad: {
        id: "squad-1",
        name: "A",
        platoonId: "platoon-1",
        platoon: { id: "platoon-1", name: "P1" },
      },
      activityReports: [],
    };
    mockSoldierFindUnique.mockResolvedValue(soldier as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("s1");
    expect(body.givenName).toBe("John");
    expect(body.missingActivities).toEqual([]);
  });

  it("returns soldier for company_commander when squad is in their company", async () => {
    const assignment = mockAssignment({
      role: "company_commander",
      unitType: "company",
      unitId: "comp-1",
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    // isSquadInScope calls prisma.squad.findUnique for company_commander
    mockSquadFindUnique.mockResolvedValue({
      platoon: { companyId: "comp-1" },
    } as never);

    const soldier = {
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      givenName: "Alice",
      familyName: "Cohen",
      rank: null,
      status: "active",
      profileImage: null,
      squad: {
        id: "squad-1",
        name: "A",
        platoonId: "platoon-1",
        platoon: { id: "platoon-1", name: "P1" },
      },
      activityReports: [],
    };
    mockSoldierFindUnique.mockResolvedValue(soldier as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.givenName).toBe("Alice");
  });

  it("returns 403 for company_commander when squad is in different company", async () => {
    const assignment = mockAssignment({
      role: "company_commander",
      unitType: "company",
      unitId: "comp-1",
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    mockSquadFindUnique.mockResolvedValue({
      platoon: { companyId: "comp-other" },
    } as never);

    mockSoldierFindUnique.mockResolvedValue({
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      squad: {
        id: "squad-1",
        name: "A",
        platoonId: "platoon-1",
        platoon: { id: "platoon-1", name: "P1" },
      },
      activityReports: [],
    } as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(403);
  });

  it("returns soldier for platoon_commander when squad is in their platoon", async () => {
    const assignment = mockAssignment({
      role: "platoon_commander",
      unitType: "platoon",
      unitId: "platoon-1",
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);

    // isSquadInScope calls prisma.squad.findUnique for platoon_commander
    mockSquadFindUnique.mockResolvedValue({
      platoonId: "platoon-1",
    } as never);

    const soldier = {
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      givenName: "Jane",
      familyName: "Smith",
      rank: null,
      status: "active",
      profileImage: null,
      squad: {
        id: "squad-1",
        name: "A",
        platoonId: "platoon-1",
        platoon: { id: "platoon-1", name: "P1" },
      },
      activityReports: [],
    };
    mockSoldierFindUnique.mockResolvedValue(soldier as never);
    mockActivityFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/soldiers/s1");
    const res = await GET(req, makeParams("s1"));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/soldiers/[id]
// ---------------------------------------------------------------------------
describe("PATCH /api/soldiers/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      givenName: "Updated",
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid input", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      status: "invalid_status",
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when soldier not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      givenName: "Updated",
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when squad is out of scope", async () => {
    const assignment = mockAssignment({
      role: "squad_commander",
      unitType: "squad",
      unitId: "squad-other",
    });
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [assignment] }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({
      cycleId: "cycle-1",
      squadId: "squad-1",
    } as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      givenName: "Updated",
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(403);
  });

  it("updates soldier profile fields for admin", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({
      cycleId: "cycle-1",
      squadId: "squad-1",
    } as never);

    const updatedSoldier = {
      id: "s1",
      givenName: "Updated",
      familyName: "Name",
      rank: "corporal",
      status: "active",
    };
    mockSoldierUpdate.mockResolvedValue(updatedSoldier as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      givenName: "Updated",
      familyName: "Name",
      rank: "corporal",
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.givenName).toBe("Updated");
    expect(mockSoldierUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { givenName: "Updated", familyName: "Name", rank: "corporal" },
    });
  });
  it("updates idNumber for admin", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({
      cycleId: "cycle-1",
      squadId: "squad-1",
    } as never);

    mockSoldierUpdate.mockResolvedValue({
      id: "s1", givenName: "John", familyName: "Doe", idNumber: "7654321",
      rank: null, status: "active",
    } as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      idNumber: "7654321",
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(200);

    expect(mockSoldierUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { idNumber: "7654321" },
    });
  });

  it("clears idNumber when set to null", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({
      cycleId: "cycle-1",
      squadId: "squad-1",
    } as never);

    mockSoldierUpdate.mockResolvedValue({
      id: "s1", givenName: "John", familyName: "Doe", idNumber: null,
    } as never);

    const req = createMockRequest("PATCH", "/api/soldiers/s1", {
      idNumber: null,
    });
    const res = await PATCH(req, makeParams("s1"));
    expect(res.status).toBe(200);

    expect(mockSoldierUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { idNumber: null },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/soldiers/[id]/mark-na
// ---------------------------------------------------------------------------
describe("POST /api/soldiers/[id]/mark-na", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/soldiers/s1/mark-na");
    const res = await markNaPost(req, makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when soldier not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/soldiers/s1/mark-na");
    const res = await markNaPost(req, makeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("returns count 0 when no missing activities", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1", isAdmin: true }),
    } as never);

    mockSoldierFindUnique.mockResolvedValue({
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      squad: { platoonId: "platoon-1" },
    } as never);

    mockActivityFindMany.mockResolvedValue([
      { id: "act-1" },
      { id: "act-2" },
    ] as never);

    // All activities already have reports
    mockReportFindMany.mockResolvedValue([
      { activityId: "act-1" },
      { activityId: "act-2" },
    ] as never);

    const req = createMockRequest("POST", "/api/soldiers/s1/mark-na");
    const res = await markNaPost(req, makeParams("s1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.count).toBe(0);
  });

  it("creates NA reports for missing activities", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1", isAdmin: true }),
    } as never);

    mockSoldierFindUnique.mockResolvedValue({
      id: "s1",
      cycleId: "cycle-1",
      squadId: "squad-1",
      squad: { platoonId: "platoon-1" },
    } as never);

    mockActivityFindMany.mockResolvedValue([
      { id: "act-1" },
      { id: "act-2" },
      { id: "act-3" },
    ] as never);

    // Only act-1 has a report
    mockReportFindMany.mockResolvedValue([
      { activityId: "act-1" },
    ] as never);

    mockReportCreateMany.mockResolvedValue({ count: 2 } as never);

    const req = createMockRequest("POST", "/api/soldiers/s1/mark-na");
    const res = await markNaPost(req, makeParams("s1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.count).toBe(2);

    expect(mockReportCreateMany).toHaveBeenCalledWith({
      data: [
        {
          activityId: "act-2",
          soldierId: "s1",
          result: "na",
          updatedByUserId: "user-1",
        },
        {
          activityId: "act-3",
          soldierId: "s1",
          result: "na",
          updatedByUserId: "user-1",
        },
      ],
      skipDuplicates: true,
    });
  });
});
