import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    invitation: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/twilio", () => ({
  sendWhatsAppOtp: vi.fn(),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: () => null }),
}));

import { POST } from "../send/route";
import { prisma } from "@/lib/db/prisma";
import { sendWhatsAppOtp } from "@/lib/twilio";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockFindUser = vi.mocked(prisma.user.findUnique);
const mockFindInvitation = vi.mocked(prisma.invitation.findFirst);
const mockSendOtp = vi.mocked(sendWhatsAppOtp);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/whatsapp/send", () => {
  it("returns 400 when phone is missing", async () => {
    const req = createMockRequest("POST", "/api/auth/whatsapp/send", {});

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is empty string", async () => {
    const req = createMockRequest("POST", "/api/auth/whatsapp/send", {
      phone: "",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns success (200) even when no user or invitation found (anti-enumeration)", async () => {
    mockFindUser.mockResolvedValue(null);
    mockFindInvitation.mockResolvedValue(null);

    const req = createMockRequest("POST", "/api/auth/whatsapp/send", {
      phone: "+972501234567",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // OTP should NOT be sent when no user/invitation found
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("sends OTP when user exists with that phone", async () => {
    mockFindUser.mockResolvedValue({ id: "user-1" } as never);
    mockSendOtp.mockResolvedValue(undefined as never);

    const req = createMockRequest("POST", "/api/auth/whatsapp/send", {
      phone: "+972501234567",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSendOtp).toHaveBeenCalledWith("+972501234567");
    // Should not check invitations when user is found
    expect(mockFindInvitation).not.toHaveBeenCalled();
  });

  it("sends OTP when no user but a pending invitation exists", async () => {
    mockFindUser.mockResolvedValue(null);
    mockFindInvitation.mockResolvedValue({ id: "inv-1" } as never);
    mockSendOtp.mockResolvedValue(undefined as never);

    const req = createMockRequest("POST", "/api/auth/whatsapp/send", {
      phone: "+972501234567",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSendOtp).toHaveBeenCalledWith("+972501234567");
  });

  it("returns 500 when Twilio throws", async () => {
    mockFindUser.mockResolvedValue({ id: "user-1" } as never);
    mockSendOtp.mockRejectedValue(new Error("Twilio down"));

    const req = createMockRequest("POST", "/api/auth/whatsapp/send", {
      phone: "+972501234567",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when body is not valid JSON", async () => {
    // createMockRequest with no body sends no content-type header
    const req = new Request("http://localhost:3000/api/auth/whatsapp/send", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(req);

    const res = await POST(nextReq);
    expect(res.status).toBe(400);
  });
});
