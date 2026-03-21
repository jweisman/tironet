import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userCycleAssignment: {
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
const mockAssignmentUpdate = vi.mocked(prisma.userCycleAssignment.update);
const mockAssignmentDelete = vi.mocked(prisma.userCycleAssignment.delete);

beforeEach(() => {
  vi.clearAllMocks();
});

function adminSuccess() {
  mockRequireAdmin.mockResolvedValue({
    error: null,
    session: { user: { isAdmin: true, id: "admin-1" } } as never,
  });
}

function adminFailure() {
  mockRequireAdmin.mockResolvedValue({
    error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
    session: null,
  });
}

const idParams = { params: Promise.resolve({ id: "user-1" }) };

describe("PATCH /api/admin/users/[id]", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/users/user-1", {
      assignmentId: "a1",
      role: "platoon_commander",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(403);
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for missing assignmentId", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/users/user-1", {
      role: "platoon_commander",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(400);
  });

  it("updates assignment role", async () => {
    adminSuccess();
    mockAssignmentUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1", {
      assignmentId: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9",
      role: "squad_commander",
    });

    const res = await PATCH(req, idParams);

    expect(res.status).toBe(204);
    expect(mockAssignmentUpdate).toHaveBeenCalledWith({
      where: { id: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9", userId: "user-1" },
      data: { role: "squad_commander" },
    });
  });

  it("updates assignment unitType and unitId together", async () => {
    adminSuccess();
    mockAssignmentUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1", {
      assignmentId: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9",
      unitType: "squad",
      unitId: "b5b5b5b5-c6c6-4d7d-8e8e-f9f9f9f9f9f9",
    });

    const res = await PATCH(req, idParams);

    expect(res.status).toBe(204);
    expect(mockAssignmentUpdate).toHaveBeenCalledWith({
      where: { id: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9", userId: "user-1" },
      data: {
        unitType: "squad",
        unitId: "b5b5b5b5-c6c6-4d7d-8e8e-f9f9f9f9f9f9",
      },
    });
  });

  it("returns 400 for invalid role value", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/users/user-1", {
      assignmentId: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9",
      role: "invalid_role",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(400);
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("DELETE", "/api/admin/users/user-1", {
      assignmentId: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9",
    });

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(403);
    expect(mockAssignmentDelete).not.toHaveBeenCalled();
  });

  it("deletes assignment and returns 204", async () => {
    adminSuccess();
    mockAssignmentDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/users/user-1", {
      assignmentId: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9",
    });

    const res = await DELETE(req, idParams);

    expect(res.status).toBe(204);
    expect(mockAssignmentDelete).toHaveBeenCalledWith({
      where: { id: "a5a5a5a5-b6b6-4c7c-8d8d-e9e9e9e9e9e9", userId: "user-1" },
    });
  });

  it("returns 400 for missing assignmentId", async () => {
    adminSuccess();

    const req = createMockRequest("DELETE", "/api/admin/users/user-1", {});

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(400);
    expect(mockAssignmentDelete).not.toHaveBeenCalled();
  });
});
