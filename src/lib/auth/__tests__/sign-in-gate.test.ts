import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userCycleAssignment: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    invitation: { findFirst: vi.fn() },
  },
}));

// Must mock NextAuth and its providers before importing auth.ts,
// otherwise the module-level NextAuth() call tries to load real providers.
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));
vi.mock("next-auth/providers/google", () => ({ default: vi.fn() }));
vi.mock("next-auth/providers/nodemailer", () => ({ default: vi.fn() }));
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn() }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("@/lib/twilio", () => ({ verifySmsOtp: vi.fn() }));

import { isSignInAllowed } from "../auth";
import { prisma } from "@/lib/db/prisma";

const mockFindFirstAssignment = vi.mocked(prisma.userCycleAssignment.findFirst);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockInvitationFindFirst = vi.mocked(prisma.invitation.findFirst);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isSignInAllowed", () => {
  it("allows user with existing cycle assignment", async () => {
    mockFindFirstAssignment.mockResolvedValue({ id: "assign-1" } as never);

    const result = await isSignInAllowed({ id: "user-1", email: "a@b.com" });
    expect(result).toBe(true);
    expect(mockFindFirstAssignment).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true },
    });
  });

  it("allows user with pending email invitation", async () => {
    mockFindFirstAssignment.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ phone: null } as never);
    mockInvitationFindFirst.mockResolvedValue({ id: "inv-1" } as never);

    const result = await isSignInAllowed({ id: "user-1", email: "invited@example.com" });
    expect(result).toBe(true);
    expect(mockInvitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          acceptedAt: null,
          OR: [{ email: "invited@example.com" }],
        }),
      })
    );
  });

  it("allows user with pending phone invitation", async () => {
    mockFindFirstAssignment.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ phone: "+972501234567" } as never);
    mockInvitationFindFirst.mockResolvedValue({ id: "inv-2" } as never);

    const result = await isSignInAllowed({ id: "user-1", email: null });
    expect(result).toBe(true);
    expect(mockInvitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ phone: "+972501234567" }],
        }),
      })
    );
  });

  it("allows admin user without assignment or invitation", async () => {
    mockFindFirstAssignment.mockResolvedValue(null);
    // First call for phone lookup, second for isAdmin check
    mockUserFindUnique
      .mockResolvedValueOnce({ phone: null } as never)
      .mockResolvedValueOnce({ isAdmin: true } as never);
    mockInvitationFindFirst.mockResolvedValue(null);

    const result = await isSignInAllowed({ id: "admin-1", email: "admin@example.com" });
    expect(result).toBe(true);
  });

  it("blocks user with no assignment, no invitation, and not admin", async () => {
    mockFindFirstAssignment.mockResolvedValue(null);
    mockUserFindUnique
      .mockResolvedValueOnce({ phone: null } as never)
      .mockResolvedValueOnce({ isAdmin: false } as never);
    mockInvitationFindFirst.mockResolvedValue(null);

    const result = await isSignInAllowed({ id: "rando-1", email: "rando@gmail.com" });
    expect(result).toBe(false);
  });

  it("blocks user with no id, no email", async () => {
    const result = await isSignInAllowed({ email: null });
    expect(result).toBe(false);
  });

  it("checks email case-insensitively", async () => {
    mockFindFirstAssignment.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ phone: null } as never);
    mockInvitationFindFirst.mockResolvedValue({ id: "inv-1" } as never);

    await isSignInAllowed({ id: "user-1", email: "UPPER@CASE.COM" });
    expect(mockInvitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ email: "upper@case.com" }],
        }),
      })
    );
  });

  it("checks both email and phone when both exist", async () => {
    mockFindFirstAssignment.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ phone: "+972501111111" } as never);
    mockInvitationFindFirst.mockResolvedValue({ id: "inv-1" } as never);

    await isSignInAllowed({ id: "user-1", email: "both@example.com" });
    expect(mockInvitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ email: "both@example.com" }, { phone: "+972501111111" }],
        }),
      })
    );
  });
});
