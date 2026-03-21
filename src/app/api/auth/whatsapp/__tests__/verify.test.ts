import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    invitation: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/twilio", () => ({
  verifyWhatsAppOtp: vi.fn(),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: () => null }),
}));

import { POST } from "../verify/route";
import { prisma } from "@/lib/db/prisma";
import { verifyWhatsAppOtp } from "@/lib/twilio";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockFindUser = vi.mocked(prisma.user.findUnique);
const mockVerifyOtp = vi.mocked(verifyWhatsAppOtp);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/whatsapp/verify", () => {
  it("returns 400 when phone is missing", async () => {
    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {
      code: "123456",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is missing", async () => {
    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {
      phone: "+972501234567",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {});

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when user not found", async () => {
    mockFindUser.mockResolvedValue(null);

    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {
      phone: "+972501234567",
      code: "123456",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBeDefined();
    // Should not call verify if user doesn't exist
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("returns 401 when OTP code is invalid", async () => {
    mockFindUser.mockResolvedValue({ id: "user-1", email: "a@b.com" } as never);
    mockVerifyOtp.mockResolvedValue(false);

    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {
      phone: "+972501234567",
      code: "000000",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBeDefined();
    expect(mockVerifyOtp).toHaveBeenCalledWith("+972501234567", "000000");
  });

  it("returns email when user exists and OTP is valid", async () => {
    mockFindUser.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
    } as never);
    mockVerifyOtp.mockResolvedValue(true);

    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {
      phone: "+972501234567",
      code: "123456",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBe("test@example.com");
    expect(mockVerifyOtp).toHaveBeenCalledWith("+972501234567", "123456");
  });

  it("returns 500 when Twilio throws", async () => {
    mockFindUser.mockResolvedValue({ id: "user-1", email: "a@b.com" } as never);
    mockVerifyOtp.mockRejectedValue(new Error("Twilio error"));

    const req = createMockRequest("POST", "/api/auth/whatsapp/verify", {
      phone: "+972501234567",
      code: "123456",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });
});
