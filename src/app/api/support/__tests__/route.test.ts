import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(),
}));

import { POST } from "../route";
import { auth } from "@/lib/auth/auth";
import { sendEmail } from "@/lib/email/send";
import { createMockRequest, mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockSendEmail = vi.mocked(sendEmail);

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined as never);
});

describe("POST /api/support", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("POST", "/api/support", {
      diagnostics: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user has no cycle assignments and is not admin", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [], isAdmin: false }),
    } as never);
    const req = createMockRequest("POST", "/api/support", {
      diagnostics: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("allows admin user without cycle assignments", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [], isAdmin: true }),
    } as never);
    const req = createMockRequest("POST", "/api/support", {
      description: "test",
      diagnostics: { device: { os: "test" } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it("allows user with cycle assignment", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    const req = createMockRequest("POST", "/api/support", {
      description: "help",
      diagnostics: { device: { os: "iOS" } },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalled();
  });
});
