import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    company: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    platoon: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    squad: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

import { POST } from "../route";
import { PATCH as PATCH_ID, DELETE as DELETE_ID } from "../[id]/route";
import { PATCH as PATCH_REORDER } from "../reorder/route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockCompanyCreate = vi.mocked(prisma.company.create);
const mockPlatoonCreate = vi.mocked(prisma.platoon.create);
const mockSquadCreate = vi.mocked(prisma.squad.create);
const mockCompanyUpdate = vi.mocked(prisma.company.update);
const mockPlatoonUpdate = vi.mocked(prisma.platoon.update);
const mockSquadUpdate = vi.mocked(prisma.squad.update);
const mockCompanyDelete = vi.mocked(prisma.company.delete);
const mockPlatoonDelete = vi.mocked(prisma.platoon.delete);
const mockSquadDelete = vi.mocked(prisma.squad.delete);
const mockTransaction = vi.mocked(prisma.$transaction);

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

const UUID = "550e8400-e29b-41d4-a716-446655440001";

// ---------------------------------------------------------------------------
// POST /api/admin/structure — create
// ---------------------------------------------------------------------------
describe("POST /api/admin/structure", () => {
  it("creates a company with next sortOrder", async () => {
    adminSuccess();
    const created = { id: "comp-1", cycleId: UUID, name: "Alpha" };
    vi.mocked(prisma.company.aggregate).mockResolvedValue({ _max: { sortOrder: 2 } } as never);
    mockCompanyCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "company",
      cycleId: UUID,
      name: "Alpha",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(created);
    expect(mockCompanyCreate).toHaveBeenCalledWith({
      data: { cycleId: UUID, name: "Alpha", sortOrder: 3 },
    });
  });

  it("creates a platoon with next sortOrder", async () => {
    adminSuccess();
    const created = { id: "plt-1", companyId: UUID, name: "Platoon 1" };
    vi.mocked(prisma.platoon.aggregate).mockResolvedValue({ _max: { sortOrder: 1 } } as never);
    mockPlatoonCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "platoon",
      companyId: UUID,
      name: "Platoon 1",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(created);
    expect(mockPlatoonCreate).toHaveBeenCalledWith({
      data: { companyId: UUID, name: "Platoon 1", sortOrder: 2 },
    });
  });

  it("creates a squad with next sortOrder", async () => {
    adminSuccess();
    const created = { id: "sq-1", platoonId: UUID, name: "Squad 1" };
    vi.mocked(prisma.squad.aggregate).mockResolvedValue({ _max: { sortOrder: null } } as never);
    mockSquadCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "squad",
      platoonId: UUID,
      name: "Squad 1",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(created);
    expect(mockSquadCreate).toHaveBeenCalledWith({
      data: { platoonId: UUID, name: "Squad 1", sortOrder: 0 },
    });
  });

  it("returns 400 for invalid type", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "battalion",
      name: "X",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing name", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "company",
      cycleId: UUID,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for company missing cycleId", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "company",
      name: "Alpha",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for platoon missing companyId", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "platoon",
      name: "P1",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for squad missing platoonId", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "squad",
      name: "S1",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("POST", "/api/admin/structure", {
      type: "company",
      cycleId: UUID,
      name: "Alpha",
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockCompanyCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/structure/[id] — rename
// ---------------------------------------------------------------------------
describe("PATCH /api/admin/structure/[id]", () => {
  const idParams = { params: Promise.resolve({ id: "unit-1" }) };

  it("renames a company", async () => {
    adminSuccess();
    const updated = { id: "unit-1", name: "Bravo" };
    mockCompanyUpdate.mockResolvedValue(updated as never);

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      type: "company",
      name: "Bravo",
    });

    const res = await PATCH_ID(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(updated);
    expect(mockCompanyUpdate).toHaveBeenCalledWith({
      where: { id: "unit-1" },
      data: { name: "Bravo" },
    });
  });

  it("renames a platoon", async () => {
    adminSuccess();
    mockPlatoonUpdate.mockResolvedValue({ id: "unit-1", name: "P2" } as never);

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      type: "platoon",
      name: "P2",
    });

    const res = await PATCH_ID(req, idParams);
    expect(res.status).toBe(200);
    expect(mockPlatoonUpdate).toHaveBeenCalledWith({
      where: { id: "unit-1" },
      data: { name: "P2" },
    });
  });

  it("renames a squad", async () => {
    adminSuccess();
    mockSquadUpdate.mockResolvedValue({ id: "unit-1", name: "S2" } as never);

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      type: "squad",
      name: "S2",
    });

    const res = await PATCH_ID(req, idParams);
    expect(res.status).toBe(200);
    expect(mockSquadUpdate).toHaveBeenCalledWith({
      where: { id: "unit-1" },
      data: { name: "S2" },
    });
  });

  it("returns 400 for empty name", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      type: "company",
      name: "",
    });

    const res = await PATCH_ID(req, idParams);
    expect(res.status).toBe(400);
    expect(mockCompanyUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for missing type", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      name: "X",
    });

    const res = await PATCH_ID(req, idParams);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      type: "battalion",
      name: "X",
    });

    const res = await PATCH_ID(req, idParams);
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/structure/unit-1", {
      type: "company",
      name: "X",
    });

    const res = await PATCH_ID(req, idParams);
    expect(res.status).toBe(403);
    expect(mockCompanyUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/structure/[id]
// ---------------------------------------------------------------------------
describe("DELETE /api/admin/structure/[id]", () => {
  const idParams = { params: Promise.resolve({ id: "unit-1" }) };

  it("deletes a company", async () => {
    adminSuccess();
    mockCompanyDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/structure/unit-1", {
      type: "company",
    });

    const res = await DELETE_ID(req, idParams);
    expect(res.status).toBe(204);
    expect(mockCompanyDelete).toHaveBeenCalledWith({ where: { id: "unit-1" } });
  });

  it("deletes a platoon", async () => {
    adminSuccess();
    mockPlatoonDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/structure/unit-1", {
      type: "platoon",
    });

    const res = await DELETE_ID(req, idParams);
    expect(res.status).toBe(204);
    expect(mockPlatoonDelete).toHaveBeenCalledWith({ where: { id: "unit-1" } });
  });

  it("deletes a squad", async () => {
    adminSuccess();
    mockSquadDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/structure/unit-1", {
      type: "squad",
    });

    const res = await DELETE_ID(req, idParams);
    expect(res.status).toBe(204);
    expect(mockSquadDelete).toHaveBeenCalledWith({ where: { id: "unit-1" } });
  });

  it("returns 400 for missing type", async () => {
    adminSuccess();

    const req = createMockRequest("DELETE", "/api/admin/structure/unit-1", {});
    const res = await DELETE_ID(req, idParams);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    adminSuccess();

    const req = createMockRequest("DELETE", "/api/admin/structure/unit-1", {
      type: "battalion",
    });

    const res = await DELETE_ID(req, idParams);
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("DELETE", "/api/admin/structure/unit-1", {
      type: "company",
    });

    const res = await DELETE_ID(req, idParams);
    expect(res.status).toBe(403);
    expect(mockCompanyDelete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/structure/reorder
// ---------------------------------------------------------------------------
describe("PATCH /api/admin/structure/reorder", () => {
  const UUID1 = "550e8400-e29b-41d4-a716-446655440001";
  const UUID2 = "550e8400-e29b-41d4-a716-446655440002";

  it("reorders companies via $transaction", async () => {
    adminSuccess();
    mockCompanyUpdate.mockResolvedValue({} as never);
    mockTransaction.mockResolvedValue([] as never);

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "company",
      ids: [UUID1, UUID2],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(204);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const txArg = mockTransaction.mock.calls[0][0] as unknown as unknown[];
    expect(txArg).toHaveLength(2);
  });

  it("reorders platoons via $transaction", async () => {
    adminSuccess();
    mockPlatoonUpdate.mockResolvedValue({} as never);
    mockTransaction.mockResolvedValue([] as never);

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "platoon",
      ids: [UUID1, UUID2],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(204);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("reorders squads via $transaction", async () => {
    adminSuccess();
    mockSquadUpdate.mockResolvedValue({} as never);
    mockTransaction.mockResolvedValue([] as never);

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "squad",
      ids: [UUID1],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(204);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for missing type", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      ids: [UUID1],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for empty ids", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "company",
      ids: [],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-uuid ids", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "company",
      ids: ["not-a-uuid"],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "battalion",
      ids: [UUID1],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/structure/reorder", {
      type: "company",
      ids: [UUID1],
    });

    const res = await PATCH_REORDER(req);
    expect(res.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
