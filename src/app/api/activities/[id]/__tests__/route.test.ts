import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityScope } from "@/lib/api/activity-scope";

vi.mock("@/lib/api/activity-scope", () => ({
  getActivityScope: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activity: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { GET, PATCH, DELETE } from "../route";
import { getActivityScope } from "@/lib/api/activity-scope";
import { prisma } from "@/lib/db/prisma";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";
import { NextResponse } from "next/server";

const mockGetActivityScope = vi.mocked(getActivityScope);
const mockPrisma = vi.mocked(prisma, true);

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

const fullActivity = {
  id: "act-1",
  name: "Shooting Drill",
  date: new Date("2026-03-15"),
  status: "active",
  isRequired: true,
  cycleId: "cycle-1",
  platoonId: "platoon-1",
  activityType: { id: "type-1", name: "Shooting", icon: "target" },
  platoon: {
    id: "platoon-1",
    name: "Platoon A",
    company: { name: "Company Alpha" },
    squads: [
      {
        id: "squad-1",
        name: "Squad 1",
        soldiers: [
          {
            id: "s1",
            givenName: "Avi",
            familyName: "Cohen",
            rank: "private",
            profileImage: null,
            status: "active",
          },
        ],
      },
      {
        id: "squad-2",
        name: "Squad 2",
        soldiers: [
          {
            id: "s2",
            givenName: "Dana",
            familyName: "Levi",
            rank: "private",
            profileImage: null,
            status: "active",
          },
        ],
      },
    ],
  },
  reports: [{ id: "r1", soldierId: "s1", result: "passed", grade1: null, grade2: null, grade3: null, grade4: null, grade5: null, grade6: null, note: null }],
};

// ---------------------------------------------------------------------------
// GET /api/activities/[id]
// ---------------------------------------------------------------------------

describe("GET /api/activities/[id]", () => {
  it("returns 404 when activity not found", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest("GET", "/api/activities/act-999");
    const res = await GET(req, makeParams("act-999"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no access to the platoon", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(fullActivity as never);
    const scope = makePlatoonCommanderScope({ platoonIds: ["other-platoon"] });
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/activities/act-1");
    const res = await GET(req, makeParams("act-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when squad_commander tries to view draft activity", async () => {
    const draftActivity = { ...fullActivity, status: "draft" };
    mockPrisma.activity.findUnique.mockResolvedValue(draftActivity as never);

    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/activities/act-1");
    const res = await GET(req, makeParams("act-1"));
    expect(res.status).toBe(403);
  });

  it("squad_commander sees only their squad", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(fullActivity as never);

    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/activities/act-1");
    const res = await GET(req, makeParams("act-1"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.squads).toHaveLength(1);
    expect(json.squads[0].id).toBe("squad-1");
    expect(json.canEditMetadata).toBe(false);
    expect(json.canEditReports).toBe(true);
  });

  it("platoon_commander sees all squads with canEditMetadata", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(fullActivity as never);

    const scope = makePlatoonCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/activities/act-1");
    const res = await GET(req, makeParams("act-1"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.squads).toHaveLength(2);
    expect(json.canEditMetadata).toBe(true);
    expect(json.canEditReports).toBe(true);
    expect(json.squads[0].soldiers[0].report.result).toBe("passed");
    expect(json.squads[1].soldiers[0].report.result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/activities/[id]
// ---------------------------------------------------------------------------

describe("PATCH /api/activities/[id]", () => {
  it("returns 404 when activity not found", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/activities/act-999", {
      name: "New Name",
    });
    const res = await PATCH(req, makeParams("act-999"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user cannot edit metadata", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("PATCH", "/api/activities/act-1", {
      name: "Changed",
    });
    const res = await PATCH(req, makeParams("act-1"));
    expect(res.status).toBe(403);
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

    const req = createMockRequest("PATCH", "/api/activities/act-1", {
      date: "not-a-date",
    });
    const res = await PATCH(req, makeParams("act-1"));
    expect(res.status).toBe(400);
  });

  it("updates activity successfully", async () => {
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

    const updatedActivity = {
      id: "act-1",
      name: "Updated Name",
      date: new Date("2026-04-01"),
      status: "active",
      isRequired: true,
      activityType: { id: "type-1", name: "Shooting", icon: "target" },
      platoon: {
        id: "platoon-1",
        name: "Platoon A",
        company: { name: "Company Alpha" },
      },
    };
    mockPrisma.activity.update.mockResolvedValue(updatedActivity as never);

    const req = createMockRequest("PATCH", "/api/activities/act-1", {
      name: "Updated Name",
      date: "2026-04-01",
    });
    const res = await PATCH(req, makeParams("act-1"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.activity.name).toBe("Updated Name");
    expect(json.activity.platoon.companyName).toBe("Company Alpha");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/activities/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/activities/[id]", () => {
  it("returns 404 when activity not found", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue(null as never);

    const req = createMockRequest("DELETE", "/api/activities/act-999");
    const res = await DELETE(req, makeParams("act-999"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user cannot edit metadata", async () => {
    mockPrisma.activity.findUnique.mockResolvedValue({
      cycleId: "cycle-1",
      platoonId: "platoon-1",
    } as never);

    const scope = makeSquadCommanderScope();
    mockGetActivityScope.mockResolvedValue({
      scope,
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("DELETE", "/api/activities/act-1");
    const res = await DELETE(req, makeParams("act-1"));
    expect(res.status).toBe(403);
  });

  it("deletes activity and returns 204", async () => {
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

    mockPrisma.activity.delete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/activities/act-1");
    const res = await DELETE(req, makeParams("act-1"));
    expect(res.status).toBe(204);
    expect(mockPrisma.activity.delete).toHaveBeenCalledWith({
      where: { id: "act-1" },
    });
  });
});
