import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    request: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    requestAction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/api/request-scope", () => ({
  getRequestScope: vi.fn(),
}));

vi.mock("@/lib/requests/workflow", () => ({
  getNextState: vi.fn(),
  canActOnRequest: vi.fn(() => true),
}));

vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
  notifyAssignedRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn((fn: () => void) => fn()) };
});

import { GET, PATCH, DELETE } from "../route";
import { prisma } from "@/lib/db/prisma";
import { getRequestScope } from "@/lib/api/request-scope";
import { getNextState, canActOnRequest } from "@/lib/requests/workflow";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";

const mockCanActOnRequest = vi.mocked(canActOnRequest);
const mockGetScope = vi.mocked(getRequestScope);
const mockRequestFindUnique = vi.mocked(prisma.request.findUnique);
const mockRequestUpdate = vi.mocked(prisma.request.update);
const mockRequestDelete = vi.mocked(prisma.request.delete);
const mockGetNextState = vi.mocked(getNextState);
const mockTransaction = vi.mocked(prisma.$transaction);

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const baseRequest = {
  id: "req-1",
  cycleId: "cycle-1",
  soldierId: "sol-1",
  type: "leave",
  status: "open",
  assignedRole: "platoon_commander",
  createdByUserId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default: canActOnRequest returns true unless overridden
  mockCanActOnRequest.mockReset();
  mockCanActOnRequest.mockReturnValue(true);
  // Mock $transaction to resolve array transactions and return first element
  mockTransaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) {
      const results = await Promise.all(ops);
      return results;
    }
    return ops;
  });
  vi.mocked(prisma.requestAction.create).mockResolvedValue({} as never);
});

// ---------------------------------------------------------------------------
// GET /api/requests/[id]
// ---------------------------------------------------------------------------
describe("GET /api/requests/[id]", () => {
  it("returns 404 when request not found", async () => {
    mockRequestFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("GET", "/api/requests/req-1");
    const res = await GET(req, makeParams("req-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when soldier is not in scope", async () => {
    mockRequestFindUnique.mockResolvedValue({
      ...baseRequest,
      soldier: { id: "sol-1", givenName: "Avi", familyName: "Cohen", squad: { name: "A", platoon: { name: "P1" } } },
    } as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: ["other-soldier"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/requests/req-1");
    const res = await GET(req, makeParams("req-1"));
    expect(res.status).toBe(403);
  });

  it("returns request with soldier details", async () => {
    const fullRequest = {
      ...baseRequest,
      soldier: { id: "sol-1", givenName: "Avi", familyName: "Cohen", squad: { name: "A", platoon: { name: "P1" } } },
      createdBy: { givenName: "Dan", familyName: "Levi" },
    };
    mockRequestFindUnique.mockResolvedValue(fullRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("GET", "/api/requests/req-1");
    const res = await GET(req, makeParams("req-1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.request.id).toBe("req-1");
    expect(body.role).toBe("platoon_commander");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/requests/[id] — workflow actions
// ---------------------------------------------------------------------------
describe("PATCH /api/requests/[id] — workflow actions", () => {
  it("returns 400 with invalid body", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", { action: "invalid" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when request not found", async () => {
    mockRequestFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", { action: "approve" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(404);
  });


  it("returns 400 when transition is invalid", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockGetNextState.mockReturnValue(null);

    const req = createMockRequest("PATCH", "/api/requests/req-1", { action: "approve" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid transition");
  });

  it("returns 403 when not assigned to user's role", async () => {
    mockCanActOnRequest.mockReturnValueOnce(false);
    mockRequestFindUnique.mockResolvedValue({
      ...baseRequest,
      assignedRole: "company_commander",
    } as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockGetNextState.mockReturnValue({ newStatus: "approved", newAssignedRole: "platoon_commander" });

    const req = createMockRequest("PATCH", "/api/requests/req-1", { action: "approve" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Not assigned to you");
  });

  it("applies workflow transition on approve", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockGetNextState.mockReturnValue({ newStatus: "open", newAssignedRole: "company_commander" });
    mockRequestUpdate.mockResolvedValue({ ...baseRequest, assignedRole: "company_commander" } as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", { action: "approve" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);

    const updateCall = mockRequestUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.status).toBe("open");
    expect(updateCall.data.assignedRole).toBe("company_commander");
  });

  it("creates audit trail action with note on deny", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockGetNextState.mockReturnValue({ newStatus: "denied", newAssignedRole: "squad_commander" });
    mockRequestUpdate.mockResolvedValue({ ...baseRequest, status: "denied" } as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", {
      action: "deny",
      note: "Insufficient documentation",
    });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);

    // Verify audit trail action was created with note
    expect(prisma.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: "req-1",
          action: "deny",
          note: "Insufficient documentation",
          userId: "user-1",
        }),
      }),
    );
  });

  it("creates audit trail action with note on approve", async () => {
    const ccRequest = { ...baseRequest, assignedRole: "company_commander" };
    mockRequestFindUnique.mockResolvedValue(ccRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "company_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockGetNextState.mockReturnValue({ newStatus: "approved", newAssignedRole: "platoon_commander" });
    mockRequestUpdate.mockResolvedValue({ ...ccRequest, status: "approved" } as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", {
      action: "approve",
      note: "Approved with conditions",
    });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);

    expect(prisma.requestAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: "req-1",
          action: "approve",
          note: "Approved with conditions",
          userId: "user-1",
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/requests/[id] — field edits
// ---------------------------------------------------------------------------
describe("PATCH /api/requests/[id] — field edits", () => {
  it("returns 403 when non-admin non-assigned role edits", async () => {
    mockCanActOnRequest.mockReturnValueOnce(false);
    mockRequestFindUnique.mockResolvedValue({
      ...baseRequest,
      assignedRole: "company_commander",
    } as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("PATCH", "/api/requests/req-1", { description: "Updated" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(403);
  });

  it("allows assigned role to edit fields", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockRequestUpdate.mockResolvedValue({ ...baseRequest, description: "Updated" } as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", { description: "Updated" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);
  });

  it("applies connector sync fields (status + assignedRole)", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockRequestUpdate.mockResolvedValue({ ...baseRequest, status: "approved", assignedRole: null } as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", {
      status: "approved",
      assignedRole: null,
    });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);

    const updateCall = mockRequestUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.status).toBe("approved");
    expect(updateCall.data.assignedRole).toBeNull();
  });

  it("allows company_medic to edit medical request fields", async () => {
    const medicalRequest = { ...baseRequest, type: "medical", assignedRole: "platoon_commander" };
    mockCanActOnRequest.mockReturnValueOnce(false); // medic doesn't match assignedRole
    mockRequestFindUnique.mockResolvedValue(medicalRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "company_medic",
        soldierIds: ["sol-1"],
        squadIds: [],
        platoonIds: ["pl-1"],
        canCreate: false,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockRequestUpdate.mockResolvedValue({
      ...medicalRequest,
      medicalAppointments: [{ id: "a1", date: "2026-04-10", place: "Hospital", type: "Checkup" }],
    } as never);

    const req = createMockRequest("PATCH", "/api/requests/req-1", {
      medicalAppointments: [{ id: "a1", date: "2026-04-10", place: "Hospital", type: "Checkup" }],
    });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);
  });

  it("blocks company_medic from editing non-medical request fields", async () => {
    mockCanActOnRequest.mockReturnValueOnce(false);
    mockRequestFindUnique.mockResolvedValue({
      ...baseRequest,
      type: "leave",
      assignedRole: "platoon_commander",
    } as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "company_medic",
        soldierIds: ["sol-1"],
        squadIds: [],
        platoonIds: ["pl-1"],
        canCreate: false,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("PATCH", "/api/requests/req-1", { description: "Updated" });
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(403);
  });

  it("returns existing request when no fields to update", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("PATCH", "/api/requests/req-1", {});
    const res = await PATCH(req, makeParams("req-1"));
    expect(res.status).toBe(200);
    expect(mockRequestUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/requests/[id]
// ---------------------------------------------------------------------------
describe("DELETE /api/requests/[id]", () => {
  it("returns 404 when request not found", async () => {
    mockRequestFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("DELETE", "/api/requests/req-1");
    const res = await DELETE(req, makeParams("req-1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when request is not open", async () => {
    mockRequestFindUnique.mockResolvedValue({ ...baseRequest, status: "approved" } as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("DELETE", "/api/requests/req-1");
    const res = await DELETE(req, makeParams("req-1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Can only delete open requests");
  });

  it("deletes open request successfully", async () => {
    mockRequestFindUnique.mockResolvedValue(baseRequest as never);
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: ["sol-1"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });
    mockRequestDelete.mockResolvedValue(baseRequest as never);

    const req = createMockRequest("DELETE", "/api/requests/req-1");
    const res = await DELETE(req, makeParams("req-1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRequestDelete).toHaveBeenCalledWith({ where: { id: "req-1" } });
  });
});
