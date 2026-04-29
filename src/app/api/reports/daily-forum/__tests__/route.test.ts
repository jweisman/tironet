import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/reports/render-attendance", () => ({
  fetchAttendance: vi.fn().mockResolvedValue({ platoons: [] }),
  STATUS_LABELS: { present: "נוכח", leave: "יציאה", medical_appointment: "תור רפואי", sick_day: "יום מחלה", inactive: "לא פעיל" },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    cycle: { findUnique: vi.fn() },
    platoon: { findMany: vi.fn() },
    request: { findMany: vi.fn() },
    activity: { findMany: vi.fn() },
    squad: { findMany: vi.fn() },
    soldier: { groupBy: vi.fn() },
    commanderEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/api/report-scope", () => ({
  getReportScope: vi.fn(),
}));

import { GET } from "../route";
import { getReportScope } from "@/lib/api/report-scope";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";

const mockGetScope = vi.mocked(getReportScope);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports/daily-forum", () => {
  it("returns 400 without cycleId", async () => {
    const req = createMockRequest("GET", "/api/reports/daily-forum");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("GET", "/api/reports/daily-forum", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for instructor role", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "instructor",
        platoonIds: ["p1"],
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/reports/daily-forum", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("not available");
  });

  it("returns 403 for company_medic role", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "company_medic",
        platoonIds: ["p1"],
        companyId: "c1",
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/reports/daily-forum", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 200 for platoon_commander", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        platoonIds: ["p1"],
      },
      error: null,
      user: mockSessionUser(),
    });

    // Mock the Prisma calls inside fetchDailyForum
    const { prisma } = await import("@/lib/db/prisma");
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      name: "Test Cycle",
    } as never);
    vi.mocked(prisma.platoon.findMany).mockResolvedValue([
      {
        id: "p1",
        name: "Platoon 1",
        sortOrder: 1,
        company: { name: "Company A" },
        squads: [],
      },
    ] as never);
    vi.mocked(prisma.request.findMany).mockResolvedValue([]);
    vi.mocked(prisma.activity.findMany).mockResolvedValue([]);
    vi.mocked(prisma.squad.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.soldier.groupBy).mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/reports/daily-forum", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.cycleName).toBe("Test Cycle");
    expect(body.platoons).toHaveLength(1);
    expect(body.platoons[0].platoonName).toBe("Platoon 1");
  });

  it("returns 200 for company_commander", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "company_commander",
        platoonIds: ["p1", "p2"],
        companyId: "c1",
      },
      error: null,
      user: mockSessionUser(),
    });

    const { prisma } = await import("@/lib/db/prisma");
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      name: "Test Cycle",
    } as never);
    vi.mocked(prisma.platoon.findMany).mockResolvedValue([
      {
        id: "p1",
        name: "Platoon 1",
        sortOrder: 1,
        company: { name: "Company A" },
        squads: [],
      },
      {
        id: "p2",
        name: "Platoon 2",
        sortOrder: 2,
        company: { name: "Company A" },
        squads: [],
      },
    ] as never);
    vi.mocked(prisma.request.findMany).mockResolvedValue([]);
    vi.mocked(prisma.activity.findMany).mockResolvedValue([]);
    vi.mocked(prisma.squad.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.soldier.groupBy).mockResolvedValue([] as never);

    const req = createMockRequest("GET", "/api/reports/daily-forum", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.platoons).toHaveLength(2);
  });

  it("returns 404 when cycle not found", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        platoonIds: ["p1"],
      },
      error: null,
      user: mockSessionUser(),
    });

    const { prisma } = await import("@/lib/db/prisma");
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(null);

    const req = createMockRequest("GET", "/api/reports/daily-forum", undefined, {
      cycleId: "cycle-1",
    });
    const res = await GET(req);
    expect(res.status).toBe(404);
  });
});
