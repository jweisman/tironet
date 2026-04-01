import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    request: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/api/request-scope", () => ({
  getRequestScope: vi.fn(),
}));

import { GET, POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { getRequestScope } from "@/lib/api/request-scope";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";

const mockGetScope = vi.mocked(getRequestScope);
const mockRequestCreate = vi.mocked(prisma.request.create);
const mockRequestFindMany = vi.mocked(prisma.request.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/requests
// ---------------------------------------------------------------------------
describe("POST /api/requests", () => {
  const validBody = {
    cycleId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    soldierId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    type: "leave" as const,
    description: "Family event",
    place: "Tel Aviv",
  };

  it("returns 400 when body is invalid", async () => {
    const req = createMockRequest("POST", "/api/requests", { bad: "data" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("POST", "/api/requests", validBody);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user cannot create requests", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "company_commander",
        soldierIds: [validBody.soldierId],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: false,
      },
      error: null,
      user: mockSessionUser(),
    });

    const req = createMockRequest("POST", "/api/requests", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  it("returns 403 when soldier is not in scope", async () => {
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

    const req = createMockRequest("POST", "/api/requests", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Soldier not in scope");
  });

  it("creates request as squad_commander → assigns to platoon_commander", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: [validBody.soldierId],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const fakeRequest = { id: "req-1", ...validBody, status: "open", assignedRole: "platoon_commander" };
    mockRequestCreate.mockResolvedValue(fakeRequest as never);

    const req = createMockRequest("POST", "/api/requests", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockRequestCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.assignedRole).toBe("platoon_commander");
    expect(createCall.data.status).toBe("open");
    expect(createCall.data.createdByUserId).toBe("user-1");
  });

  it("creates request as platoon_commander → assigns to company_commander", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "platoon_commander",
        soldierIds: [validBody.soldierId],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    mockRequestCreate.mockResolvedValue({ id: "req-2" } as never);

    const req = createMockRequest("POST", "/api/requests", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockRequestCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.assignedRole).toBe("company_commander");
  });

  it("uses client-provided id when present", async () => {
    const clientId = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: [validBody.soldierId],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    mockRequestCreate.mockResolvedValue({ id: clientId } as never);

    const req = createMockRequest("POST", "/api/requests", { ...validBody, id: clientId });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockRequestCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.id).toBe(clientId);
  });

  it("persists date fields as Date objects", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: [validBody.soldierId],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    mockRequestCreate.mockResolvedValue({ id: "req-4" } as never);

    const bodyWithDates = {
      ...validBody,
      departureAt: "2026-04-01T08:00:00Z",
      returnAt: "2026-04-03T18:00:00Z",
    };

    const req = createMockRequest("POST", "/api/requests", bodyWithDates);
    await POST(req);

    const createCall = mockRequestCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.departureAt).toBeInstanceOf(Date);
    expect(createCall.data.returnAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// GET /api/requests
// ---------------------------------------------------------------------------
describe("GET /api/requests", () => {
  it("returns 400 when cycleId is missing", async () => {
    const req = createMockRequest("GET", "/api/requests");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("cycleId is required");
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetScope.mockResolvedValue({
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    });

    const req = createMockRequest("GET", "/api/requests", undefined, { cycleId: "c1" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns requests scoped to soldier IDs", async () => {
    mockGetScope.mockResolvedValue({
      scope: {
        role: "squad_commander",
        soldierIds: ["sol-1", "sol-2"],
        squadIds: ["sq-1"],
        platoonIds: ["pl-1"],
        canCreate: true,
      },
      error: null,
      user: mockSessionUser(),
    });

    const fakeRequests = [
      { id: "r1", type: "leave", soldierId: "sol-1" },
      { id: "r2", type: "medical", soldierId: "sol-2" },
    ];
    mockRequestFindMany.mockResolvedValue(fakeRequests as never);

    const req = createMockRequest("GET", "/api/requests", undefined, { cycleId: "c1" });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.requests).toHaveLength(2);
    expect(body.role).toBe("squad_commander");

    // Verify the query filters by soldier IDs
    const findCall = mockRequestFindMany.mock.calls[0][0] as {
      where: { soldierId: { in: string[] } };
    };
    expect(findCall.where.soldierId.in).toEqual(["sol-1", "sol-2"]);
  });
});
