import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    activityType: {
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

import { PATCH, DELETE } from "../route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockUpdate = vi.mocked(prisma.activityType.update);
const mockDelete = vi.mocked(prisma.activityType.delete);

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

const idParams = { params: Promise.resolve({ id: "type-1" }) };

describe("PATCH /api/admin/activity-types/[id]", () => {
  it("updates name", async () => {
    adminSuccess();
    const updated = { id: "type-1", name: "Updated", icon: "🏃", isActive: true };
    mockUpdate.mockResolvedValue(updated as never);

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      name: "Updated",
    });

    const res = await PATCH(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "type-1" },
      data: { name: "Updated" },
    });
  });

  it("updates icon", async () => {
    adminSuccess();
    mockUpdate.mockResolvedValue({ id: "type-1", icon: "🏊" } as never);

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      icon: "🏊",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "type-1" },
      data: { icon: "🏊" },
    });
  });

  it("updates isActive", async () => {
    adminSuccess();
    mockUpdate.mockResolvedValue({ id: "type-1", isActive: false } as never);

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      isActive: false,
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "type-1" },
      data: { isActive: false },
    });
  });

  it("updates multiple fields at once", async () => {
    adminSuccess();
    const updated = { id: "type-1", name: "New", icon: "🎯", isActive: false };
    mockUpdate.mockResolvedValue(updated as never);

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      name: "New",
      icon: "🎯",
      isActive: false,
    });

    const res = await PATCH(req, idParams);
    const body = await res.json();

    expect(body).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "type-1" },
      data: { name: "New", icon: "🎯", isActive: false },
    });
  });

  it("updates score labels", async () => {
    adminSuccess();
    const updated = {
      id: "type-1", name: "כש״ג", icon: "shield", isActive: true,
      score1Label: "מתח", score2Label: "בנץ׳", score3Label: null,
      score4Label: null, score5Label: null, score6Label: null,
    };
    mockUpdate.mockResolvedValue(updated as never);

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      score1Label: "מתח",
      score2Label: "בנץ׳",
      score3Label: null,
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.score1Label).toBe("מתח");
    expect(body.score2Label).toBe("בנץ׳");
    expect(body.score3Label).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "type-1" },
      data: { score1Label: "מתח", score2Label: "בנץ׳", score3Label: null },
    });
  });

  it("returns 400 for invalid input (empty name)", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      name: "",
    });

    const res = await PATCH(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid input");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid isActive type", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      isActive: "not-a-boolean",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/activity-types/type-1", {
      name: "Updated",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/activity-types/[id]", () => {
  it("deletes and returns 204", async () => {
    adminSuccess();
    mockDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/activity-types/type-1");

    const res = await DELETE(req, idParams);

    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "type-1" } });
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("DELETE", "/api/admin/activity-types/type-1");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
