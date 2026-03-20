import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET, PATCH } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest, mockSessionUser } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockUserUpdate = vi.mocked(prisma.user.update);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------
describe("GET /api/users/me", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns profile image for authenticated user", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);

    mockUserFindUnique.mockResolvedValue({
      profileImage: "https://example.com/photo.jpg",
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.profileImage).toBe("https://example.com/photo.jpg");
  });

  it("returns null profileImage when user has no image", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);

    mockUserFindUnique.mockResolvedValue({
      profileImage: null,
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.profileImage).toBeNull();
  });

  it("returns null profileImage when user record not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);

    mockUserFindUnique.mockResolvedValue(null as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.profileImage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/users/me
// ---------------------------------------------------------------------------
describe("PATCH /api/users/me", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/users/me", {
      givenName: "Updated",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid input", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);

    const req = createMockRequest("PATCH", "/api/users/me", {
      givenName: "", // min(1) validation fails
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("updates user profile and returns 204", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);

    mockUserUpdate.mockResolvedValue({} as never);

    const req = createMockRequest("PATCH", "/api/users/me", {
      givenName: "Updated",
      familyName: "Name",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(204);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { givenName: "Updated", familyName: "Name" },
    });
  });
});
