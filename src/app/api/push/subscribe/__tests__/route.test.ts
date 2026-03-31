import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    pushSubscription: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { POST, DELETE } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockUpsert = vi.mocked(prisma.pushSubscription.upsert);
const mockDeleteMany = vi.mocked(prisma.pushSubscription.deleteMany);

beforeEach(() => {
  vi.clearAllMocks();
});

const validSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfXRs",
    auth: "tBHItJI5svbpC7gE1Hs-vg",
  },
};

describe("POST /api/push/subscribe", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("POST", "/api/push/subscribe", validSubscription);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 with invalid body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    const req = createMockRequest("POST", "/api/push/subscribe", { endpoint: "not-a-url" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("upserts subscription on success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockUpsert.mockResolvedValue({} as never);

    const req = createMockRequest("POST", "/api/push/subscribe", validSubscription);
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { endpoint: validSubscription.endpoint },
      create: {
        userId: "user-1",
        endpoint: validSubscription.endpoint,
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
      },
      update: {
        userId: "user-1",
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
      },
    });
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("DELETE", "/api/push/subscribe", { endpoint: validSubscription.endpoint });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 with invalid endpoint", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    const req = createMockRequest("DELETE", "/api/push/subscribe", { endpoint: "not-a-url" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("deletes subscription on success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockDeleteMany.mockResolvedValue({ count: 1 } as never);

    const req = createMockRequest("DELETE", "/api/push/subscribe", { endpoint: validSubscription.endpoint });
    const res = await DELETE(req);
    expect(res.status).toBe(200);

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { endpoint: validSubscription.endpoint, userId: "user-1" },
    });
  });
});
