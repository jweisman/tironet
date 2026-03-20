import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockCheckCreate = vi.fn();

vi.mock("twilio", () => ({
  default: () => ({
    verify: {
      v2: {
        services: () => ({
          verifications: { create: mockCreate },
          verificationChecks: { create: mockCheckCreate },
        }),
      },
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test_token");
  vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VA_test");
});

// The module reads env vars at import time. We need to re-import after setting env.
// Use dynamic import with vi.resetModules() to force re-evaluation.

describe("sendWhatsAppOtp", () => {
  it("calls Twilio verifications.create with SMS channel", async () => {
    mockCreate.mockResolvedValue({ sid: "VE_123" });

    vi.resetModules();
    const { sendWhatsAppOtp } = await import("../twilio");
    await sendWhatsAppOtp("+972501234567");

    expect(mockCreate).toHaveBeenCalledWith({
      to: "+972501234567",
      channel: "sms",
    });
  });
});

describe("verifyWhatsAppOtp", () => {
  it("returns true when status is approved", async () => {
    mockCheckCreate.mockResolvedValue({ status: "approved" });

    vi.resetModules();
    const { verifyWhatsAppOtp } = await import("../twilio");
    const result = await verifyWhatsAppOtp("+972501234567", "123456");
    expect(result).toBe(true);

    expect(mockCheckCreate).toHaveBeenCalledWith({
      to: "+972501234567",
      code: "123456",
    });
  });

  it("returns false when status is not approved", async () => {
    mockCheckCreate.mockResolvedValue({ status: "pending" });

    vi.resetModules();
    const { verifyWhatsAppOtp } = await import("../twilio");
    const result = await verifyWhatsAppOtp("+972501234567", "000000");
    expect(result).toBe(false);
  });
});
