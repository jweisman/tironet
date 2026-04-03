import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    requestAction: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { PATCH } from "../../[id]/route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockFindUnique = vi.mocked(prisma.requestAction.findUnique);
const mockUpdate = vi.mocked(prisma.requestAction.update);

beforeEach(() => {
  vi.clearAllMocks();
});

const actionId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const makeParams = () => ({ params: Promise.resolve({ id: actionId }) });

describe("PATCH /api/request-actions/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      note: "updated",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 400 with invalid body", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1" },
    } as never);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      bad: "data",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(400);
  });

  it("returns 404 when action not found", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    mockFindUnique.mockResolvedValue(null);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      note: "updated",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when editing another user's note", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    mockFindUnique.mockResolvedValue({
      id: actionId,
      userId: "user-2",
      request: { assignedRole: "platoon_commander" },
    } as never);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      note: "updated",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(403);
  });

  it("returns 400 when request is completed (assignedRole is null)", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    mockFindUnique.mockResolvedValue({
      id: actionId,
      userId: "user-1",
      request: { assignedRole: null },
    } as never);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      note: "updated",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("completed");
  });

  it("updates note successfully", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    mockFindUnique.mockResolvedValue({
      id: actionId,
      userId: "user-1",
      request: { assignedRole: "platoon_commander" },
    } as never);
    mockUpdate.mockResolvedValue({
      id: actionId,
      note: "updated note",
    } as never);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      note: "updated note",
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: actionId },
      data: { note: "updated note" },
    });
  });

  it("accepts null note", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    mockFindUnique.mockResolvedValue({
      id: actionId,
      userId: "user-1",
      request: { assignedRole: "company_commander" },
    } as never);
    mockUpdate.mockResolvedValue({
      id: actionId,
      note: null,
    } as never);

    const req = createMockRequest("PATCH", `/api/request-actions/${actionId}`, {
      note: null,
    });
    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(200);

    const updateCall = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.note).toBeNull();
  });
});
