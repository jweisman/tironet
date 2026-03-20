import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activityType: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { mockSessionUser } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockFindMany = vi.mocked(prisma.activityType.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/activity-types", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns active activity types for authenticated user", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser(),
    } as never);

    const types = [
      { id: "t1", name: "Shooting", icon: "target" },
      { id: "t2", name: "March", icon: "boot" },
    ];
    mockFindMany.mockResolvedValue(types as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(types);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, name: true, icon: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });

  it("returns empty array when no active types exist", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser(),
    } as never);

    mockFindMany.mockResolvedValue([] as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
  });
});
