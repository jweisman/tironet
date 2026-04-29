import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activityType: {
      findMany: vi.fn(),
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
  it("returns list of activity types ordered by name", async () => {
    adminSuccess();
    const types = [
      { id: "t1", name: "Run", icon: "🏃", isActive: true },
      { id: "t2", name: "Swim", icon: "🏊", isActive: true },
    ];
    mockFindMany.mockResolvedValue(types as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(types);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
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
  it("creates activity type", async () => {
    adminSuccess();
    const created = { id: "t3", name: "March", icon: "🥾", isActive: true };
    mockCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "March",
      icon: "🥾",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(created);
    expect(mockCreate).toHaveBeenCalledWith({
      data: { name: "March", icon: "🥾" },
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

  it("creates activity type with scoreConfig", async () => {
    adminSuccess();

    const scoreConfig = {
      score1: { label: "מתח", format: "number" },
      score2: { label: "בנץ׳", format: "number" },
      score3: { label: "מקבילים", format: "number" },
      score4: { label: "ריצה", format: "time" },
      score5: { label: "ספרינט", format: "time" },
      score6: { label: "ציון סופי", format: "number" },
    };
    const created = {
      id: "t4", name: "כש״ג", icon: "shield", isActive: true,
      scoreConfig,
    };
    mockCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "כש״ג",
      icon: "shield",
      scoreConfig,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.scoreConfig.score1.label).toBe("מתח");
    expect(body.scoreConfig.score6.label).toBe("ציון סופי");
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scoreConfig,
      }),
    });
  });

  it("creates activity type with displayConfiguration", async () => {
    adminSuccess();

    const displayConfiguration = {
      results: {
        completed: { label: "נוכח" },
        skipped: { label: "לא נוכח" },
        na: { label: "פטור" },
      },
      note: { type: "list", options: ["קיר", "חבל", "זמן"] },
    };
    mockCreate.mockResolvedValue({ id: "t5", name: "שיחה", icon: "MessageCircle", displayConfiguration } as never);

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "שיחה",
      icon: "MessageCircle",
      displayConfiguration,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayConfiguration,
      }),
    });
  });

  it("accepts null displayConfiguration to clear config", async () => {
    adminSuccess();

    mockCreate.mockResolvedValue({ id: "t6" } as never);

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "Test",
      icon: "Activity",
      displayConfiguration: null,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("returns 400 for invalid displayConfiguration (empty label)", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "Test",
      icon: "Activity",
      displayConfiguration: {
        results: {
          completed: { label: "" },
          skipped: { label: "לא נוכח" },
          na: { label: "פטור" },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid displayConfiguration (empty options array)", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/activity-types", {
      name: "Test",
      icon: "Activity",
      displayConfiguration: {
        note: { type: "list", options: [] },
      },
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
