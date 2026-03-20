import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    cycle: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

import { GET, POST } from "../route";
import { PATCH as PATCH_ID, DELETE as DELETE_ID } from "../[id]/route";
import { PATCH as PATCH_REORDER } from "../reorder/route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockFindMany = vi.mocked(prisma.cycle.findMany);
const mockCreate = vi.mocked(prisma.cycle.create);
const mockUpdate = vi.mocked(prisma.cycle.update);
const mockDelete = vi.mocked(prisma.cycle.delete);
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

// ---------------------------------------------------------------------------
// GET /api/admin/cycles
// ---------------------------------------------------------------------------
describe("GET /api/admin/cycles", () => {
  it("returns cycles ordered by createdAt desc", async () => {
    adminSuccess();
    const cycles = [
      { id: "c1", name: "Cycle 1", isActive: true },
      { id: "c2", name: "Cycle 2", isActive: false },
    ];
    mockFindMany.mockResolvedValue(cycles as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(cycles);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/cycles
// ---------------------------------------------------------------------------
describe("POST /api/admin/cycles", () => {
  it("creates a cycle", async () => {
    adminSuccess();
    const created = { id: "c3", name: "New Cycle", isActive: true };
    mockCreate.mockResolvedValue(created as never);

    const req = createMockRequest("POST", "/api/admin/cycles", { name: "New Cycle" });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(created);
    expect(mockCreate).toHaveBeenCalledWith({ data: { name: "New Cycle" } });
  });

  it("returns 400 for missing name", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/cycles", {});
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for empty name", async () => {
    adminSuccess();

    const req = createMockRequest("POST", "/api/admin/cycles", { name: "" });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("POST", "/api/admin/cycles", { name: "Cycle" });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/cycles/[id]
// ---------------------------------------------------------------------------
describe("PATCH /api/admin/cycles/[id]", () => {
  const idParams = { params: Promise.resolve({ id: "c1" }) };

  it("updates isActive", async () => {
    adminSuccess();
    mockUpdate.mockResolvedValue({ id: "c1", isActive: false } as never);

    const req = createMockRequest("PATCH", "/api/admin/cycles/c1", { isActive: false });
    const res = await PATCH_ID(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isActive: false },
    });
  });

  it("updates name", async () => {
    adminSuccess();
    mockUpdate.mockResolvedValue({ id: "c1", name: "Renamed" } as never);

    const req = createMockRequest("PATCH", "/api/admin/cycles/c1", { name: "Renamed" });
    const res = await PATCH_ID(req, idParams);

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Renamed" },
    });
  });

  it("returns 400 for empty name", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/cycles/c1", { name: "" });
    const res = await PATCH_ID(req, idParams);

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid isActive type", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/cycles/c1", { isActive: "yes" });
    const res = await PATCH_ID(req, idParams);

    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/cycles/c1", { name: "X" });
    const res = await PATCH_ID(req, idParams);

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/cycles/[id]
// ---------------------------------------------------------------------------
describe("DELETE /api/admin/cycles/[id]", () => {
  const idParams = { params: Promise.resolve({ id: "c1" }) };

  it("deletes and returns 204", async () => {
    adminSuccess();
    mockDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/cycles/c1");
    const res = await DELETE_ID(req, idParams);

    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("DELETE", "/api/admin/cycles/c1");
    const res = await DELETE_ID(req, idParams);

    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/cycles/reorder
// ---------------------------------------------------------------------------
describe("PATCH /api/admin/cycles/reorder", () => {
  it("reorders cycles via $transaction", async () => {
    adminSuccess();
    mockUpdate.mockResolvedValue({} as never);
    mockTransaction.mockResolvedValue([] as never);

    const ids = [
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440003",
    ];
    const req = createMockRequest("PATCH", "/api/admin/cycles/reorder", { ids });
    const res = await PATCH_REORDER(req);

    expect(res.status).toBe(204);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The transaction receives an array of Prisma update promises
    const txArg = mockTransaction.mock.calls[0][0] as unknown[];
    expect(txArg).toHaveLength(3);
  });

  it("returns 400 for empty ids array", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/cycles/reorder", { ids: [] });
    const res = await PATCH_REORDER(req);

    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for non-uuid ids", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/cycles/reorder", { ids: ["not-uuid"] });
    const res = await PATCH_REORDER(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing ids", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/cycles/reorder", {});
    const res = await PATCH_REORDER(req);

    expect(res.status).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/cycles/reorder", {
      ids: ["550e8400-e29b-41d4-a716-446655440001"],
    });
    const res = await PATCH_REORDER(req);

    expect(res.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
