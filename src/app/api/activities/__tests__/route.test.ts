import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityScope } from "@/lib/api/activity-scope";

vi.mock("@/lib/api/activity-scope", () => ({
  getActivityScope: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activity: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    soldier: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    platoon: {
      findFirst: vi.fn(),
    },
  },
}));

import { GET, POST } from "../route";
import { getActivityScope } from "@/lib/api/activity-scope";
import { prisma } from "@/lib/db/prisma";
import {
  createMockRequest,
  mockSessionUser,
} from "@/__tests__/helpers/api";
import { NextResponse } from "next/server";

const mockGetActivityScope = vi.mocked(getActivityScope);
const mockPrisma = vi.mocked(prisma, true);

// Valid v4 UUIDs for test data (version nibble = 4, variant nibble = 8-b)
const UUID_CYCLE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_PLATOON = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID_PLATOON_OTHER = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const UUID_ACTIVITY_TYPE = "d4e5f6a7-b8c9-4d0e-af2a-3b4c5d6e7f80";

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

// ---------------------------------------------------------------------------
// GET /api/activities
// ---------------------------------------------------------------------------

describe("GET /api/activities", () => {
  it("returns 400 when cycleId is missing", async () => {
    const req = createMockRequest("GET", "/api/activities");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cycleId/i);
  });

  it("returns error when getActivityScope fails (unauthorized)", async () => {
    mockGetActivityScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("GET", "/api/activities", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns activities for platoon_commander", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    const fakeActivity = {
      id: "act-1",
      name: "Shooting Drill",
      date: new Date("2026-03-15"),
      status: "active",
      isRequired: true,
      platoonId: "platoon-1",
      activityType: { id: "type-1", name: "Shooting", icon: "target" },
      platoon: {
        id: "platoon-1",
        name: "Platoon A",
        company: { name: "Company Alpha" },
      },
      reports: [
        { result: "completed", soldierId: "s1" },
        { result: "skipped", soldierId: "s2" },
      ],
    };

    mockPrisma.activity.findMany.mockResolvedValue([fakeActivity] as never);
    mockPrisma.soldier.count.mockResolvedValue(10 as never);

    const req = createMockRequest("GET", "/api/activities", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.role).toBe("platoon_commander");
    expect(json.canCreate).toBe(true);
    expect(json.activities).toHaveLength(1);
    expect(json.activities[0].passedCount).toBe(1);
    expect(json.activities[0].failedCount).toBe(1);
    expect(json.activities[0].totalSoldiers).toBe(10);
  });

  it("squad_commander sees scoped soldier counts", async () => {
    const user = mockSessionUser();
    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    const fakeActivity = {
      id: "act-1",
      name: "March",
      date: new Date("2026-03-10"),
      status: "active",
      isRequired: true,
      platoonId: "platoon-1",
      activityType: { id: "type-1", name: "March", icon: "boot" },
      platoon: {
        id: "platoon-1",
        name: "Platoon A",
        company: { name: "Company Alpha" },
      },
      reports: [
        { result: "completed", soldierId: "s1" },
        { result: "completed", soldierId: "s3" }, // s3 not in squad
      ],
    };

    mockPrisma.activity.findMany.mockResolvedValue([fakeActivity] as never);

    // Squad soldiers
    mockPrisma.soldier.findMany.mockResolvedValue([
      { id: "s1" },
      { id: "s2" },
    ] as never);

    const req = createMockRequest("GET", "/api/activities", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.role).toBe("squad_commander");
    expect(json.canCreate).toBe(false);
    expect(json.activities).toHaveLength(1);

    // Only s1 is in squad -> passedCount=1, totalSoldiers=2 (size of squad)
    expect(json.activities[0].passedCount).toBe(1);
    expect(json.activities[0].totalSoldiers).toBe(2);

  });
});

// ---------------------------------------------------------------------------
// POST /api/activities
// ---------------------------------------------------------------------------

describe("POST /api/activities", () => {
  const validBody = {
    cycleId: UUID_CYCLE,
    platoonId: UUID_PLATOON,
    activityTypeId: UUID_ACTIVITY_TYPE,
    name: "Test Activity",
    date: "2026-03-20",
  };

  it("returns 400 on invalid body", async () => {
    const req = createMockRequest("POST", "/api/activities", { name: "" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns error when scope fails", async () => {
    mockGetActivityScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("POST", "/api/activities", validBody);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when canCreate is false", async () => {
    const user = mockSessionUser();
    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    const req = createMockRequest("POST", "/api/activities", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when platoon_commander tries to create for another platoon", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    const req = createMockRequest("POST", "/api/activities", {
      ...validBody,
      platoonId: UUID_PLATOON_OTHER, // not platoon-1
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when platoon not found in cycle", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope({
      platoonIds: [validBody.platoonId],
    });
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/activities", validBody);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("creates activity and returns 201", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope({
      platoonIds: [validBody.platoonId],
    });
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    mockPrisma.platoon.findFirst.mockResolvedValue({
      id: validBody.platoonId,
    } as never);

    const createdActivity = {
      id: "new-id",
      cycleId: validBody.cycleId,
      platoonId: validBody.platoonId,
      name: validBody.name,
      date: new Date(validBody.date),
      status: "draft",
      isRequired: true,
      activityType: { id: validBody.activityTypeId, name: "Shooting", icon: "target" },
      platoon: {
        id: validBody.platoonId,
        name: "Platoon A",
        company: { name: "Company Alpha" },
      },
    };
    mockPrisma.activity.create.mockResolvedValue(createdActivity as never);

    const req = createMockRequest("POST", "/api/activities", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.activity.id).toBe("new-id");
    expect(json.activity.name).toBe(validBody.name);
    expect(json.activity.platoon.companyName).toBe("Company Alpha");
  });

  it("persists notes when provided", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope({
      platoonIds: [validBody.platoonId],
    });
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    mockPrisma.platoon.findFirst.mockResolvedValue({
      id: validBody.platoonId,
    } as never);

    const createdActivity = {
      id: "new-id",
      cycleId: validBody.cycleId,
      platoonId: validBody.platoonId,
      name: validBody.name,
      date: new Date(validBody.date),
      status: "draft",
      isRequired: true,
      notes: "5 כד׳\n25 מ",
      activityType: { id: validBody.activityTypeId, name: "Shooting", icon: "target" },
      platoon: {
        id: validBody.platoonId,
        name: "Platoon A",
        company: { name: "Company Alpha" },
      },
    };
    mockPrisma.activity.create.mockResolvedValue(createdActivity as never);

    const req = createMockRequest("POST", "/api/activities", {
      ...validBody,
      notes: "5 כד׳\n25 מ",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockPrisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: "5 כד׳\n25 מ" }),
      })
    );
  });
});
