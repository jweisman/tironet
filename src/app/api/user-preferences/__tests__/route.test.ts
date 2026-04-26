import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { GET, PATCH } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockFindUnique = vi.mocked(prisma.userPreference.findUnique);
const mockUpsert = vi.mocked(prisma.userPreference.upsert);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/user-preferences", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns defaults when no preference row exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockFindUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ showTour: true });
  });

  it("returns stored preferences", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockFindUnique.mockResolvedValue({
      id: "pref-1",
      userId: "user-1",
      showTour: false,
    } as never);

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ showTour: false });
  });
});

describe("PATCH /api/user-preferences", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("PATCH", "/api/user-preferences", { showTour: false });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 with invalid body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    const req = createMockRequest("PATCH", "/api/user-preferences", { showTour: "not-a-bool" });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("upserts preference on success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockUpsert.mockResolvedValue({
      id: "pref-1",
      userId: "user-1",
      showTour: false,
    } as never);

    const req = createMockRequest("PATCH", "/api/user-preferences", { showTour: false });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.showTour).toBe(false);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", showTour: false },
      update: { showTour: false },
    });
  });
});
