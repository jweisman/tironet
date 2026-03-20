import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activityType: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

import { GET, POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockFindMany = vi.mocked(prisma.activityType.findMany);
const mockAggregate = vi.mocked(prisma.activityType.aggregate);
const mockCreate = vi.mocked(prisma.activityType.create);

beforeEach(() => {
  vi.clearAllMocks();
});

function adminSuccess() {
  mockRequireAdmin.mockResolvedValue({
    error: null,
    session: { user: { isAdmin: true } } as never,
  });
}

function adminFailure() {
  mockRequireAdmin.mockResolvedValue({
    error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
    session: null,
  });
}

describe("GET /api/admin/activity-types", () => {
  it("returns list of activity types ordered by sortOrder", async () => {
    adminSuccess();
    const types = [
      { id: "t1", name: "Run", icon: "🏃", sortOrder: 0, isActive: true },
      { id: "t2", name: "Swim", icon: "🏊", sortOrder: 1, isActive: true },
    ];
    mockFindMany.mockResolvedValue(types as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(types);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Unauthorized");
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/activity-types", () => {
  it("creates activity type with next sortOrder", async () => {
    adminSuccess();
    mockAggregate.mockResolvedValue({ _max: { sortOrder: 3 } } as never);
    const created = { id: "t3", name: "March", icon: "🥾", sortOrder: 4, isActive: true };
    mockCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "March",
      icon: "🥾",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(created);
    expect(mockAggregate).toHaveBeenCalledWith({ _max: { sortOrder: true } });
    expect(mockCreate).toHaveBeenCalledWith({
      data: { name: "March", icon: "🥾", sortOrder: 4 },
    });
  });

  it("uses sortOrder 1 when no existing types", async () => {
    adminSuccess();
    mockAggregate.mockResolvedValue({ _max: { sortOrder: null } } as never);
    mockCreate.mockResolvedValue({ id: "t1", name: "Run", icon: "🏃", sortOrder: 1 } as never);

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "Run",
      icon: "🏃",
    });

    await POST(req);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { name: "Run", icon: "🏃", sortOrder: 1 },
    });
  });

  it("returns 400 for invalid input (missing name)", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      icon: "🏃",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid input");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid input (missing icon)", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "Run",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid input");
  });

  it("returns 400 for empty name", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "",
      icon: "🏃",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "Run",
      icon: "🏃",
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
