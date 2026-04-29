import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityScope } from "@/lib/api/activity-scope";

vi.mock("@/lib/api/activity-scope", () => ({
  getActivityScope: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activity: {
      findUnique: vi.fn(),
    },
    soldier: {
      findMany: vi.fn(),
    },
    activityReport: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

import { POST } from "../route";
import { getActivityScope } from "@/lib/api/activity-scope";
import { prisma } from "@/lib/db/prisma";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";
import { NextResponse } from "next/server";

const mockGetActivityScope = vi.mocked(getActivityScope);
const mockPrisma = vi.mocked(prisma, true);

// Valid v4 UUIDs for test data
const UUID_SOLDIER_1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_SOLDIER_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlatoonCommanderScope(
  overrides: Partial<ActivityScope> = {}
): ActivityScope {
  return {
    role: "platoon_commander",
    platoonIds: ["platoon-1"],
    platoons: [{ id: "platoon-1", name: "Platoon A" }],
    canCreate: true,
    canEditMetadataForPlatoon: (pid: string) => pid === "platoon-1",
    ...overrides,
  };
}

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// POST /api/activities/[id]/reports/bulk
// ---------------------------------------------------------------------------

describe("POST /api/activities/[id]/reports/bulk", () => {
  it("returns 404 when activity not found", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest(
      "POST",
      "/api/activities/act-1/reports/bulk",
      { result: "completed", soldierIds: [UUID_SOLDIER_1] }
    );
    const res = await POST(req, makeParams("act-1"));
    expect(res.status).toBe(404);
  });

  it("returns error when scope check fails", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    mockGetActivityScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest(
      "POST",
      "/api/activities/act-1/reports/bulk",
      { result: "completed", soldierIds: [UUID_SOLDIER_1] }
    );
    const res = await POST(req, makeParams("act-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest(
      "POST",
      "/api/activities/act-1/reports/bulk",
      { result: "invalid", soldierIds: [] }
    );
    const res = await POST(req, makeParams("act-1"));
    expect(res.status).toBe(400);
  });

  it("returns {updated: 0} when all soldiers already have reports", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    // All soldiers already have reports
    mockPrisma.activityReport.findMany.mockResolvedValue([
      { soldierId: UUID_SOLDIER_1 },
      { soldierId: UUID_SOLDIER_2 },
    ] as never);

    const req = createMockRequest(
      "POST",
      "/api/activities/act-1/reports/bulk",
      {
        result: "completed",
        soldierIds: [UUID_SOLDIER_1, UUID_SOLDIER_2],
      }
    );
    const res = await POST(req, makeParams("act-1"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.updated).toBe(0);
  });

  it("returns 403 when no soldiers are editable by user", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makePlatoonCommanderScope({ platoonIds: ["other-platoon"] });
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    mockPrisma.activityReport.findMany.mockResolvedValue([] as never);

    // Soldiers are in a platoon the user can't access
    mockPrisma.soldier.findMany.mockResolvedValue([
      {
        id: UUID_SOLDIER_1,
        squadId: "squad-x",
        squad: { platoonId: "platoon-1" },
      },
    ] as never);

    const req = createMockRequest(
      "POST",
      "/api/activities/act-1/reports/bulk",
      {
        result: "completed",
        soldierIds: [UUID_SOLDIER_1],
      }
    );
    const res = await POST(req, makeParams("act-1"));
    expect(res.status).toBe(403);
  });

  it("creates reports in bulk successfully", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    // One existing, one missing
    mockPrisma.activityReport.findMany.mockResolvedValue([
      { soldierId: UUID_SOLDIER_1 },
    ] as never);

    mockPrisma.soldier.findMany.mockResolvedValue([
      {
        id: UUID_SOLDIER_2,
        squadId: "squad-1",
        squad: { platoonId: "platoon-1" },
      },
    ] as never);

    mockPrisma.activityReport.createMany.mockResolvedValue({
      count: 1,
    } as never);

    const req = createMockRequest(
      "POST",
      "/api/activities/act-1/reports/bulk",
      {
        result: "completed",
        soldierIds: [UUID_SOLDIER_1, UUID_SOLDIER_2],
      }
    );
    const res = await POST(req, makeParams("act-1"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.updated).toBe(1);

    // Verify createMany was called with only the missing soldier
    expect(mockPrisma.activityReport.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            activityId: "act-1",
            soldierId: UUID_SOLDIER_2,
            result: "completed",
          }),
        ],
        skipDuplicates: true,
      })
    );
  });
});
