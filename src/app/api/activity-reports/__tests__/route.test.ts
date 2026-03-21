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
      findUnique: vi.fn(),
    },
    activityReport: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { POST } from "../route";
import { PATCH } from "../[id]/route";
import { getActivityScope } from "@/lib/api/activity-scope";
import { prisma } from "@/lib/db/prisma";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";
import { NextResponse } from "next/server";

const mockGetActivityScope = vi.mocked(getActivityScope);
const mockPrisma = vi.mocked(prisma, true);

// Valid v4 UUIDs for test data
const UUID_ACTIVITY = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_SOLDIER = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID_CLIENT = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";

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

function makeSquadCommanderScope(
  overrides: Partial<ActivityScope> = {}
): ActivityScope {
  return {
    role: "squad_commander",
    platoonIds: ["platoon-1"],
    platoons: [],
    squadId: "squad-1",
    canCreate: false,
    canEditMetadataForPlatoon: () => false,
    ...overrides,
  };
}

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// POST /api/activity-reports  (upsert)
// ---------------------------------------------------------------------------

describe("POST /api/activity-reports", () => {
  const validBody = {
    activityId: UUID_ACTIVITY,
    soldierId: UUID_SOLDIER,
    result: "passed" as const,
  };

  it("returns 400 on invalid body", async () => {
    const req = createMockRequest("POST", "/api/activity-reports", {
      result: "invalid",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when activity not found", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/activity-reports", validBody);
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/Activity/i);
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

    const req = createMockRequest("POST", "/api/activity-reports", validBody);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 404 when soldier not found", async () => {
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

    mockPrisma.soldier.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/activity-reports", validBody);
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/Soldier/i);
  });

  it("returns 403 when squad_commander cannot access soldier's squad", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makeSquadCommanderScope({ squadId: "squad-1" });
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    mockPrisma.soldier.findUnique.mockResolvedValue({
      squadId: "squad-other",
      squad: { platoonId: "platoon-1" },
    } as never);

    const req = createMockRequest("POST", "/api/activity-reports", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("upserts report successfully", async () => {
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

    mockPrisma.soldier.findUnique.mockResolvedValue({
      squadId: "squad-1",
      squad: { platoonId: "platoon-1" },
    } as never);

    const upsertedReport = {
      id: "report-1",
      activityId: validBody.activityId,
      soldierId: validBody.soldierId,
      result: "passed",
      grade: null,
      note: null,
    };
    mockPrisma.activityReport.upsert.mockResolvedValue(upsertedReport as never);

    const req = createMockRequest("POST", "/api/activity-reports", validBody);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.report.id).toBe("report-1");
    expect(json.report.result).toBe("passed");
  });

  it("passes client UUID to upsert create body", async () => {
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

    mockPrisma.soldier.findUnique.mockResolvedValue({
      squadId: "squad-1",
      squad: { platoonId: "platoon-1" },
    } as never);

    mockPrisma.activityReport.upsert.mockResolvedValue({
      id: UUID_CLIENT,
      activityId: validBody.activityId,
      soldierId: validBody.soldierId,
      result: "passed",
      grade: null,
      note: null,
    } as never);

    const req = createMockRequest("POST", "/api/activity-reports", {
      ...validBody,
      id: UUID_CLIENT,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify the client ID was passed in the create body
    expect(mockPrisma.activityReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ id: UUID_CLIENT }),
      })
    );
  });

  it("upserts with grade and note", async () => {
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

    mockPrisma.soldier.findUnique.mockResolvedValue({
      squadId: "squad-1",
      squad: { platoonId: "platoon-1" },
    } as never);

    mockPrisma.activityReport.upsert.mockResolvedValue({
      id: "report-2",
      activityId: validBody.activityId,
      soldierId: validBody.soldierId,
      result: "failed",
      grade: 65,
      note: "Needs improvement",
    } as never);

    const req = createMockRequest("POST", "/api/activity-reports", {
      ...validBody,
      result: "failed",
      grade: 65,
      note: "Needs improvement",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.report.grade).toBe(65);
    expect(json.report.note).toBe("Needs improvement");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/activity-reports/[id]
// ---------------------------------------------------------------------------

describe("PATCH /api/activity-reports/[id]", () => {
  it("returns 404 when report not found", async () => {
    mockPrisma.activityReport.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/activity-reports/r-999", {
      result: "passed",
    });
    const res = await PATCH(req, makeParams("r-999"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user cannot edit the report", async () => {
    mockPrisma.activityReport.findUnique.mockResolvedValue({
      id: "r-1",
      activity: { cycleId: "cycle-1", platoonId: "platoon-1" },
      soldier: { squadId: "squad-other", squad: { platoonId: "platoon-1" } },
    } as never);

    const scope = makeSquadCommanderScope({ squadId: "squad-1" });
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("PATCH", "/api/activity-reports/r-1", {
      result: "failed",
    });
    const res = await PATCH(req, makeParams("r-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 on invalid body", async () => {
    mockPrisma.activityReport.findUnique.mockResolvedValue({
      id: "r-1",
      activity: { cycleId: "cycle-1", platoonId: "platoon-1" },
      soldier: { squadId: "squad-1", squad: { platoonId: "platoon-1" } },
    } as never);

    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("PATCH", "/api/activity-reports/r-1", {
      result: "invalid_value",
    });
    const res = await PATCH(req, makeParams("r-1"));
    expect(res.status).toBe(400);
  });

  it("updates report successfully", async () => {
    mockPrisma.activityReport.findUnique.mockResolvedValue({
      id: "r-1",
      activity: { cycleId: "cycle-1", platoonId: "platoon-1" },
      soldier: { squadId: "squad-1", squad: { platoonId: "platoon-1" } },
    } as never);

    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    mockPrisma.activityReport.update.mockResolvedValue({
      id: "r-1",
      result: "failed",
      grade: 70,
      note: "Updated note",
    } as never);

    const req = createMockRequest("PATCH", "/api/activity-reports/r-1", {
      result: "failed",
      grade: 70,
      note: "Updated note",
    });
    const res = await PATCH(req, makeParams("r-1"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.report.result).toBe("failed");
    expect(json.report.grade).toBe(70);
    expect(json.report.note).toBe("Updated note");
  });
});
