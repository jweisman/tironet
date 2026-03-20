import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    invitation: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET, PATCH, DELETE } from "../profile/route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { auth } from "@/lib/auth/auth";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockAuth = vi.mocked(auth);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockUserUpdate = vi.mocked(prisma.user.update);
const mockUserDelete = vi.mocked(prisma.user.delete);
const mockInvitationDeleteMany = vi.mocked(prisma.invitation.deleteMany);

beforeEach(() => {
  vi.clearAllMocks();
});

function adminSuccess(userId = "admin-1") {
  mockRequireAdmin.mockResolvedValue({
    error: null,
    session: { user: { isAdmin: true, id: userId } } as never,
  });
}

function adminFailure() {
  mockRequireAdmin.mockResolvedValue({
    error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
    session: null,
  });
}

const idParams = { params: Promise.resolve({ id: "user-1" }) };

describe("GET /api/admin/users/[id]/profile", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("GET", "/api/admin/users/user-1/profile");

    const res = await GET(req, idParams);
    expect(res.status).toBe(403);
  });

  it("returns profile image", async () => {
    adminSuccess();
    mockUserFindUnique.mockResolvedValue({ profileImage: "https://img.example.com/pic.jpg" } as never);

    const req = createMockRequest("GET", "/api/admin/users/user-1/profile");

    const res = await GET(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profileImage).toBe("https://img.example.com/pic.jpg");
  });
});

describe("PATCH /api/admin/users/[id]/profile", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      givenName: "Avi",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("normalizes phone to E.164", async () => {
    adminSuccess();
    mockUserUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      phone: "050-123-4567",
    });

    const res = await PATCH(req, idParams);

    expect(res.status).toBe(204);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { phone: "+972501234567" },
    });
  });

  it("lowercases email", async () => {
    adminSuccess();
    mockUserUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      email: "TEST@Example.COM",
    });

    const res = await PATCH(req, idParams);

    expect(res.status).toBe(204);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "test@example.com" },
    });
  });

  it("returns 400 for invalid phone number", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      phone: "12345",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("allows setting phone to null", async () => {
    adminSuccess();
    mockUserUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      phone: null,
    });

    const res = await PATCH(req, idParams);

    expect(res.status).toBe(204);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { phone: null },
    });
  });

  it("updates multiple profile fields", async () => {
    adminSuccess();
    mockUserUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      givenName: "Avi",
      familyName: "Cohen",
      rank: "סרן",
      isAdmin: true,
    });

    const res = await PATCH(req, idParams);

    expect(res.status).toBe(204);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { givenName: "Avi", familyName: "Cohen", rank: "סרן", isAdmin: true },
    });
  });

  it("returns 400 for invalid input (empty givenName)", async () => {
    adminSuccess();

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      givenName: "",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 for duplicate email (P2002)", async () => {
    adminSuccess();
    const prismaError = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
      meta: { target: ["email"] },
    });
    mockUserUpdate.mockRejectedValue(prismaError);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      email: "existing@example.com",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(409);
  });

  it("returns 409 for duplicate phone (P2002)", async () => {
    adminSuccess();
    const prismaError = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
      meta: { target: ["phone"] },
    });
    mockUserUpdate.mockRejectedValue(prismaError);

    const req = createMockRequest("PATCH", "/api/admin/users/user-1/profile", {
      phone: "0501234567",
    });

    const res = await PATCH(req, idParams);
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/admin/users/[id]/profile", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const req = createMockRequest("DELETE", "/api/admin/users/user-1/profile");

    const res = await DELETE(req, idParams);
    expect(res.status).toBe(403);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("prevents self-deletion", async () => {
    adminSuccess("user-1"); // admin's own ID matches the target
    mockAuth.mockResolvedValue({ user: { id: "user-1", isAdmin: true } } as never);

    const req = createMockRequest("DELETE", "/api/admin/users/user-1/profile");

    const res = await DELETE(req, idParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Cannot delete your own account");
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("deletes user and their invitations", async () => {
    adminSuccess("admin-1");
    mockAuth.mockResolvedValue({ user: { id: "admin-1", isAdmin: true } } as never);
    mockInvitationDeleteMany.mockResolvedValue({ count: 0 } as never);
    mockUserDelete.mockResolvedValue({} as never);

    const req = createMockRequest("DELETE", "/api/admin/users/user-1/profile");

    const res = await DELETE(req, idParams);

    expect(res.status).toBe(204);
    expect(mockInvitationDeleteMany).toHaveBeenCalledWith({
      where: { invitedByUserId: "user-1" },
    });
    expect(mockUserDelete).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });
  });

  it("returns 422 when user has activity records (delete fails)", async () => {
    adminSuccess("admin-1");
    mockAuth.mockResolvedValue({ user: { id: "admin-1", isAdmin: true } } as never);
    mockInvitationDeleteMany.mockRejectedValue(new Error("FK constraint"));

    const req = createMockRequest("DELETE", "/api/admin/users/user-1/profile");

    const res = await DELETE(req, idParams);

    expect(res.status).toBe(422);
  });
});
