import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    platoon: { findMany: vi.fn() },
    activity: { findMany: vi.fn() },
    activityReport: { findMany: vi.fn() },
    userCycleAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/api/activity-scope", () => ({
  getActivityScope: vi.fn(),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";

const mockGetScope = vi.mocked(getActivityScope);
const mockPlatoonFindMany = vi.mocked(prisma.platoon.findMany);
const mockActivityFindMany = vi.mocked(prisma.activity.findMany);
const mockReportFindMany = vi.mocked(prisma.activityReport.findMany);
const mockAssignmentFindMany = vi.mocked(prisma.userCycleAssignment.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard", () => {
  it("returns 400 when cycleId is missing", async () => {
    const req = createMockRequest("GET", "/api/dashboard");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("cycleId is required");
  });

  it("returns scope error when getActivityScope fails (401)", async () => {
    mockGetScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("GET", "/api/dashboard", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns scope error when user has no assignment (403)", async () => {
    mockGetScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json(
        { error: "No assignment for this cycle" },
        { status: 403 }
      ),
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/dashboard", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns dashboard data for platoon_commander", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        platoonIds: ["platoon-1"],
        platoons: [{ id: "platoon-1", name: "Platoon 1" }],
        canCreate: true,
        canEditMetadataForPlatoon: (pid: string) => pid === "platoon-1",
      },
      error: null,
      user: mockSessionUser(),
    });

    mockPlatoonFindMany.mockResolvedValue([
      {
        id: "platoon-1",
        name: "Platoon 1",
        squads: [
          {
            id: "squad-1",
            name: "Squad A",
            soldiers: [{ id: "sol-1" }, { id: "sol-2" }],
          },
        ],
      },
    ] as never);

    mockActivityFindMany.mockResolvedValue([
      { id: "act-1", name: "March", platoonId: "platoon-1" },
      { id: "act-2", name: "Shooting", platoonId: "platoon-1" },
    ] as never);

    mockReportFindMany.mockResolvedValue([
      { soldierId: "sol-1", activityId: "act-1", result: "passed" },
      { soldierId: "sol-2", activityId: "act-1", result: "passed" },
      // act-2: sol-1 has report, sol-2 does not → gap
      { soldierId: "sol-1", activityId: "act-2", result: "failed" },
    ] as never);

    mockAssignmentFindMany.mockResolvedValue([
      {
        unitId: "squad-1",
        user: { givenName: "Dan", familyName: "Cohen", rank: "Sgt" },
      },
    ] as never);

    const req = createMockRequest("GET", "/api/dashboard", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.role).toBe("platoon_commander");
    expect(body.cycleId).toBe("cycle-1");
    expect(body.squads).toHaveLength(1);

    const squad = body.squads[0];
    expect(squad.squadId).toBe("squad-1");
    expect(squad.squadName).toBe("Squad A");
    expect(squad.soldierCount).toBe(2);
    // act-1: all reported, act-2: sol-2 missing + sol-1 failed
    expect(squad.reportedActivities).toBe(1);
    expect(squad.missingReportActivities).toBe(1);
    expect(squad.soldiersWithGaps).toBe(2); // sol-1 (failed), sol-2 (missing)
    expect(squad.commanders).toEqual(["Sgt Dan Cohen"]);
  });

  it("returns empty squads when no platoons in scope", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "admin",
        platoonIds: [],
        platoons: [],
        canCreate: true,
        canEditMetadataForPlatoon: () => true,
      },
      error: null,
      user: mockSessionUser({ isAdmin: true }),
    });

    mockPlatoonFindMany.mockResolvedValue([] as never);
    mockActivityFindMany.mockResolvedValue([] as never);
    mockAssignmentFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/dashboard", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.squads).toEqual([]);
  });

  it("filters squads for squad_commander", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        platoonIds: ["platoon-1"],
        platoons: [],
        squadId: "squad-1",
        canCreate: false,
        canEditMetadataForPlatoon: () => false,
      },
      error: null,
      user: mockSessionUser(),
    });

    mockPlatoonFindMany.mockResolvedValue([
      {
        id: "platoon-1",
        name: "Platoon 1",
        squads: [
          {
            id: "squad-1",
            name: "Squad A",
            soldiers: [{ id: "sol-1" }],
          },
          {
            id: "squad-2",
            name: "Squad B",
            soldiers: [{ id: "sol-2" }],
          },
        ],
      },
    ] as never);

    mockActivityFindMany.mockResolvedValue([] as never);
    mockAssignmentFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/dashboard", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Only squad-1 should be shown (squad_commander filter)
    expect(body.squads).toHaveLength(1);
    expect(body.squads[0].squadId).toBe("squad-1");
  });
});
