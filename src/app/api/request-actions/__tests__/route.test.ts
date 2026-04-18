import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    request: { findUnique: vi.fn() },
    requestAction: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/api/request-scope", () => ({
  getRequestScope: vi.fn(),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { getRequestScope } from "@/lib/api/request-scope";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockGetRequestScope = vi.mocked(getRequestScope);
const mockRequestFindUnique = vi.mocked(prisma.request.findUnique);
const mockActionCreate = vi.mocked(prisma.requestAction.create);

beforeEach(() => {
  vi.clearAllMocks();
});

const validBody = {
  requestId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  action: "approve" as const,
  note: "Looks good",
};

describe("POST /api/request-actions", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/request-actions", validBody);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 with invalid body", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "User", givenName: "Test" },
    } as never);

    const req = createMockRequest("POST", "/api/request-actions", { bad: "data" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when request not found", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "User", givenName: "Test" },
    } as never);
    mockRequestFindUnique.mockResolvedValue(null);

    const req = createMockRequest("POST", "/api/request-actions", validBody);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 403 when soldier not in scope", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "Cohen", givenName: "Avi" },
    } as never);
    mockRequestFindUnique.mockResolvedValue({ id: validBody.requestId, cycleId: "cycle-1", soldierId: "soldier-1" } as never);
    mockGetRequestScope.mockResolvedValue({
      scope: { role: "squad_commander" as never, soldierIds: ["other-soldier"], squadIds: [], platoonIds: [], canCreate: true },
      error: null,
      user: { id: "user-1" } as never,
    });

    const req = createMockRequest("POST", "/api/request-actions", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("creates action with server-determined userId", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "Cohen", givenName: "Avi" },
    } as never);
    mockRequestFindUnique.mockResolvedValue({ id: validBody.requestId, cycleId: "cycle-1", soldierId: "soldier-1" } as never);
    mockGetRequestScope.mockResolvedValue({
      scope: { role: "squad_commander" as never, soldierIds: ["soldier-1"], squadIds: [], platoonIds: [], canCreate: true },
      error: null,
      user: { id: "user-1" } as never,
    });
    mockActionCreate.mockResolvedValue({ id: "action-1" } as never);

    const req = createMockRequest("POST", "/api/request-actions", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: validBody.requestId,
          userId: "user-1",
          action: "approve",
          note: "Looks good",
          userName: "Cohen Avi",
        }),
      }),
    );
  });

  it("uses client-provided id when present", async () => {
    const clientId = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "Cohen", givenName: "Avi" },
    } as never);
    mockRequestFindUnique.mockResolvedValue({ id: validBody.requestId, cycleId: "cycle-1", soldierId: "soldier-1" } as never);
    mockGetRequestScope.mockResolvedValue({
      scope: { role: "squad_commander" as never, soldierIds: ["soldier-1"], squadIds: [], platoonIds: [], canCreate: true },
      error: null,
      user: { id: "user-1" } as never,
    });
    mockActionCreate.mockResolvedValue({ id: clientId } as never);

    const req = createMockRequest("POST", "/api/request-actions", {
      ...validBody,
      id: clientId,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockActionCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.id).toBe(clientId);
  });

  it("creates a note action", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "Cohen", givenName: "Avi" },
    } as never);
    mockRequestFindUnique.mockResolvedValue({ id: validBody.requestId, cycleId: "cycle-1", soldierId: "soldier-1" } as never);
    mockGetRequestScope.mockResolvedValue({
      scope: { role: "squad_commander" as never, soldierIds: ["soldier-1"], squadIds: [], platoonIds: [], canCreate: true },
      error: null,
      user: { id: "user-1" } as never,
    });
    mockActionCreate.mockResolvedValue({ id: "action-note" } as never);

    const req = createMockRequest("POST", "/api/request-actions", {
      requestId: validBody.requestId,
      action: "note",
      note: "Just a comment",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "note",
          note: "Just a comment",
        }),
      }),
    );
  });

  it("accepts null note", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", familyName: "Cohen", givenName: "Avi" },
    } as never);
    mockRequestFindUnique.mockResolvedValue({ id: validBody.requestId, cycleId: "cycle-1", soldierId: "soldier-1" } as never);
    mockGetRequestScope.mockResolvedValue({
      scope: { role: "squad_commander" as never, soldierIds: ["soldier-1"], squadIds: [], platoonIds: [], canCreate: true },
      error: null,
      user: { id: "user-1" } as never,
    });
    mockActionCreate.mockResolvedValue({ id: "action-2" } as never);

    const req = createMockRequest("POST", "/api/request-actions", {
      ...validBody,
      note: null,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockActionCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.note).toBeNull();
  });
});
