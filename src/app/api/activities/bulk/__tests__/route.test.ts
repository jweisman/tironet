import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityScope } from "@/lib/api/activity-scope";

vi.mock("@/lib/api/activity-scope", () => ({
  getActivityScope: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    platoon: { findFirst: vi.fn() },
    activityType: { findMany: vi.fn() },
    activity: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { POST } from "../route";
import { getActivityScope } from "@/lib/api/activity-scope";
import { prisma } from "@/lib/db/prisma";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";
import { NextResponse } from "next/server";

const mockGetActivityScope = vi.mocked(getActivityScope);
const mockPrisma = vi.mocked(prisma, true);

// Valid v4 UUIDs
const CYCLE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const PLATOON = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const PLATOON_OTHER = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TYPE_ID = "d4e5f6a7-b8c9-4d0e-af2a-3b4c5d6e7f80";

beforeEach(() => {
  vi.clearAllMocks();
});

function makePlatoonCommanderScope(
  overrides: Partial<ActivityScope> = {}
): ActivityScope {
  return {
    role: "platoon_commander",
    platoonIds: [PLATOON],
    platoons: [{ id: PLATOON, name: "Platoon A" }],
    canCreate: true,
    canEditMetadataForPlatoon: (pid: string) => pid === PLATOON,
    ...overrides,
  };
}

function makeSquadCommanderScope(): ActivityScope {
  return {
    role: "squad_commander",
    platoonIds: [PLATOON],
    platoons: [],
    squadId: "squad-1",
    canCreate: false,
    canEditMetadataForPlatoon: () => false,
  };
}

const validBody = {
  cycleId: CYCLE,
  platoonId: PLATOON,
  activities: [
    { activityTypeId: TYPE_ID, name: "Shooting Drill", date: "2026-04-01" },
  ],
};

describe("POST /api/activities/bulk", () => {
  it("returns 400 for invalid input (missing activities)", async () => {
    const req = createMockRequest("POST", "/api/activities/bulk", {
      cycleId: CYCLE,
      platoonId: PLATOON,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty activities array", async () => {
    const req = createMockRequest("POST", "/api/activities/bulk", {
      cycleId: CYCLE,
      platoonId: PLATOON,
      activities: [],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns error when scope fails (unauthorized)", async () => {
    mockGetActivityScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("POST", "/api/activities/bulk", validBody);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when canCreate is false (squad_commander)", async () => {
    const user = mockSessionUser();
    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    const req = createMockRequest("POST", "/api/activities/bulk", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when platoon_commander tries another platoon", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });

    const req = createMockRequest("POST", "/api/activities/bulk", {
      ...validBody,
      platoonId: PLATOON_OTHER,
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when platoon not found in cycle", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/activities/bulk", validBody);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 400 when activity type is not found", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue({ id: PLATOON } as never);
    mockPrisma.activityType.findMany.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/activities/bulk", validBody);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Activity type not found");
  });

  it("creates activities and returns 201", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue({ id: PLATOON } as never);
    mockPrisma.activityType.findMany.mockResolvedValue([{ id: TYPE_ID }] as never);
    mockPrisma.activity.findMany.mockResolvedValue([] as never);
    mockPrisma.$transaction.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/activities/bulk", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(0);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("skips duplicates and returns correct counts", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue({ id: PLATOON } as never);
    mockPrisma.activityType.findMany.mockResolvedValue([{ id: TYPE_ID }] as never);

    // One of two activities already exists
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        activityTypeId: TYPE_ID,
        name: "Shooting Drill",
        date: new Date("2026-04-01"),
      },
    ] as never);
    mockPrisma.$transaction.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/activities/bulk", {
      ...validBody,
      activities: [
        { activityTypeId: TYPE_ID, name: "Shooting Drill", date: "2026-04-01" },
        { activityTypeId: TYPE_ID, name: "Navigation", date: "2026-04-02" },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(1);
  });

  it("returns 201 with created=0 when all are duplicates", async () => {
    const user = mockSessionUser();
    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue({ id: PLATOON } as never);
    mockPrisma.activityType.findMany.mockResolvedValue([{ id: TYPE_ID }] as never);

    mockPrisma.activity.findMany.mockResolvedValue([
      {
        activityTypeId: TYPE_ID,
        name: "Shooting Drill",
        date: new Date("2026-04-01"),
      },
    ] as never);

    const req = createMockRequest("POST", "/api/activities/bulk", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.created).toBe(0);
    expect(json.skipped).toBe(1);
    // $transaction should not be called when nothing to create
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("admin can create for any platoon", async () => {
    const user = mockSessionUser({ isAdmin: true });
    const scope: ActivityScope = {
      role: "admin",
      platoonIds: [PLATOON, PLATOON_OTHER],
      platoons: [
        { id: PLATOON, name: "A" },
        { id: PLATOON_OTHER, name: "B" },
      ],
      canCreate: true,
      canEditMetadataForPlatoon: () => true,
    };
    mockGetActivityScope.mockResolvedValue({ scope, error: null, user });
    mockPrisma.platoon.findFirst.mockResolvedValue({ id: PLATOON_OTHER } as never);
    mockPrisma.activityType.findMany.mockResolvedValue([{ id: TYPE_ID }] as never);
    mockPrisma.activity.findMany.mockResolvedValue([] as never);
    mockPrisma.$transaction.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/activities/bulk", {
      ...validBody,
      platoonId: PLATOON_OTHER,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
