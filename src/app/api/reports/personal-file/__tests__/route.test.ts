import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    soldier: { findMany: vi.fn() },
    platoon: { findMany: vi.fn() },
    squad: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/api/personal-file-scope", () => ({
  getPersonalFileScope: vi.fn(),
}));

import { GET } from "../route";
import { getPersonalFileScope } from "@/lib/api/personal-file-scope";
import { prisma } from "@/lib/db/prisma";
import { createMockRequest } from "@/__tests__/helpers/api";
import { NextResponse } from "next/server";

const mockGetScope = vi.mocked(getPersonalFileScope);
const mockSoldierFindMany = vi.mocked(prisma.soldier.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports/personal-file", () => {
  it("returns 400 when cycleId is missing", async () => {
    const req = createMockRequest("GET", "/api/reports/personal-file");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns scope error when scope fails", async () => {
    mockGetScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      user: null,
    });

    const req = createMockRequest("GET", "/api/reports/personal-file", undefined, { cycleId: "cycle-1" });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns soldiers list when scope succeeds", async () => {
    mockGetScope.mockResolvedValue({
      scope: { role: "platoon_commander", platoonIds: ["p1"] },
      error: null,
      user: { id: "u1" } as never,
    });
    mockSoldierFindMany.mockResolvedValue([
      {
        id: "s1",
        givenName: "Avi",
        familyName: "Cohen",
        idNumber: "123",
        rank: "Private",
        status: "active",
        profileImage: null,
        squad: { id: "sq1", name: "Squad A", platoon: { id: "p1", name: "Platoon 1" } },
      },
    ] as never);

    const req = createMockRequest("GET", "/api/reports/personal-file", undefined, { cycleId: "cycle-1" });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.soldiers).toHaveLength(1);
    expect(data.soldiers[0].familyName).toBe("Cohen");
    expect(data.platoons).toHaveLength(1);
    expect(data.role).toBe("platoon_commander");
  });
});
