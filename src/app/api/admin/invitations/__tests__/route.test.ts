import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    invitation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    company: { findMany: vi.fn() },
    platoon: { findMany: vi.fn() },
    squad: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn(() => ({
      toString: () => "new-random-token-hex",
    })),
  };
});

import { GET } from "../route";
import { DELETE, POST } from "../[id]/route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { auth } from "@/lib/auth/auth";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockAuth = vi.mocked(auth);
const mockFindInvitations = vi.mocked(prisma.invitation.findMany);
const mockFindInvitation = vi.mocked(prisma.invitation.findUnique);
const mockDeleteInvitation = vi.mocked(prisma.invitation.delete);
const mockUpdateInvitation = vi.mocked(prisma.invitation.update);
const mockFindCompanies = vi.mocked(prisma.company.findMany);
const mockFindPlatoons = vi.mocked(prisma.platoon.findMany);
const mockFindSquads = vi.mocked(prisma.squad.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "http://localhost:3000";
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

const idParams = { params: Promise.resolve({ id: "inv-1" }) };

describe("GET /api/admin/invitations", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mockFindInvitations).not.toHaveBeenCalled();
  });

  it("returns pending invitations with unit names", async () => {
    adminSuccess();

    const now = new Date();
    const invitations = [
      {
        id: "inv-1",
        givenName: "Dan",
        familyName: "Levi",
        email: "dan@example.com",
        phone: null,
        role: "platoon_commander",
        unitId: "pl-1",
        unitType: "platoon",
        cycleId: "c1",
        token: "abc123",
        expiresAt: now,
        cycle: { name: "Cycle 1" },
      },
    ];
    mockFindInvitations.mockResolvedValue(invitations as never);
    mockFindCompanies.mockResolvedValue([{ id: "co-1", name: "Company A" }] as never);
    mockFindPlatoons.mockResolvedValue([{ id: "pl-1", name: "Platoon 1" }] as never);
    mockFindSquads.mockResolvedValue([] as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("inv-1");
    expect(body[0].unitName).toBe("Platoon 1");
    expect(body[0].cycleName).toBe("Cycle 1");
    expect(body[0].roleLabel).toBeDefined();
  });
});

describe("DELETE /api/admin/invitations/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("DELETE", "/api/admin/invitations/inv-1");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(401);
  });

  it("returns 404 when invitation not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", isAdmin: true } } as never);
    mockFindInvitation.mockResolvedValue(null);

    const req = createMockRequest("DELETE", "/api/admin/invitations/inv-1");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-admin and not the inviter", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user", isAdmin: false } } as never);
    mockFindInvitation.mockResolvedValue({
      id: "inv-1",
      invitedByUserId: "admin-1",
    } as never);

    const req = createMockRequest("DELETE", "/api/admin/invitations/inv-1");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(403);
  });

  it("allows admin to delete any invitation", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", isAdmin: true } } as never);
    mockFindInvitation.mockResolvedValue({
      id: "inv-1",
      invitedByUserId: "someone-else",
    } as never);
    mockDeleteInvitation.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/invitations/inv-1");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(204);
    expect(mockDeleteInvitation).toHaveBeenCalledWith({ where: { id: "inv-1" } });
  });

  it("allows the inviter to delete their own invitation", async () => {
    mockAuth.mockResolvedValue({ user: { id: "inviter-1", isAdmin: false } } as never);
    mockFindInvitation.mockResolvedValue({
      id: "inv-1",
      invitedByUserId: "inviter-1",
    } as never);
    mockDeleteInvitation.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/invitations/inv-1");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(204);
  });
});

describe("POST /api/admin/invitations/[id] (refresh token)", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/admin/invitations/inv-1");

    const res = await POST(req, idParams);
    expect(res.status).toBe(401);
  });

  it("refreshes token and returns new invite URL", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", isAdmin: true } } as never);
    mockFindInvitation.mockResolvedValue({
      id: "inv-1",
      invitedByUserId: "admin-1",
    } as never);
    mockUpdateInvitation.mockResolvedValue({} as never);

    const req = createMockRequest("POST", "/api/admin/invitations/inv-1");

    const res = await POST(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.inviteUrl).toContain("/invite/");
    expect(body.token).toBeDefined();
    expect(mockUpdateInvitation).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: expect.objectContaining({
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
  });
});
