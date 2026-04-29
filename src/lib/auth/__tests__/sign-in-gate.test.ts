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
    // resolveUser by id
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1", phone: null, isAdmin: false } as never);
    mockFindFirstAssignment.mockResolvedValue({ id: "assign-1" } as never);

    const result = await isSignInAllowed({ id: "user-1", email: "a@b.com" });
    expect(result).toBe(true);
    expect(mockFindFirstAssignment).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true },
    });
  });

  it("allows user with pending email invitation", async () => {
    // resolveUser by id
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1", phone: null, isAdmin: false } as never);
    mockFindFirstAssignment.mockResolvedValue(null);
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
    // resolveUser by id
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1", phone: "+972501234567", isAdmin: false } as never);
    mockFindFirstAssignment.mockResolvedValue(null);
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
    // resolveUser by id — single call returns isAdmin
    mockUserFindUnique.mockResolvedValueOnce({ id: "admin-1", phone: null, isAdmin: true } as never);
    mockFindFirstAssignment.mockResolvedValue(null);
    mockInvitationFindFirst.mockResolvedValue(null);

    const result = await isSignInAllowed({ id: "admin-1", email: "admin@example.com" });
    expect(result).toBe(true);
  });

  it("allows admin user found by email fallback (OAuth profile ID mismatch)", async () => {
    // resolveUser: id lookup returns null, email fallback finds admin
    mockUserFindUnique
      .mockResolvedValueOnce(null) // by id — not found
      .mockResolvedValueOnce({ id: "db-admin-1", phone: null, isAdmin: true } as never); // by email
    mockFindFirstAssignment.mockResolvedValue(null);
    mockInvitationFindFirst.mockResolvedValue(null);

    const result = await isSignInAllowed({ id: "oauth-profile-id", email: "admin@example.com" });
    expect(result).toBe(true);
  });

  it("allows user found by email fallback with cycle assignment", async () => {
    // resolveUser: id lookup returns null, email fallback finds user
    mockUserFindUnique
      .mockResolvedValueOnce(null) // by id
      .mockResolvedValueOnce({ id: "db-user-1", phone: null, isAdmin: false } as never); // by email
    mockFindFirstAssignment.mockResolvedValue({ id: "assign-1" } as never);

    const result = await isSignInAllowed({ id: "oauth-profile-id", email: "user@example.com" });
    expect(result).toBe(true);
    expect(mockFindFirstAssignment).toHaveBeenCalledWith({
      where: { userId: "db-user-1" },
      select: { id: true },
    });
  });

  it("blocks user with no assignment, no invitation, and not admin", async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: "rando-1", phone: null, isAdmin: false } as never);
    mockFindFirstAssignment.mockResolvedValue(null);
    mockInvitationFindFirst.mockResolvedValue(null);

    const result = await isSignInAllowed({ id: "rando-1", email: "rando@gmail.com" });
    expect(result).toBe(false);
  });

  it("blocks user with no id, no email", async () => {
    const result = await isSignInAllowed({ email: null });
    expect(result).toBe(false);
  });

  it("checks email case-insensitively", async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1", phone: null, isAdmin: false } as never);
    mockFindFirstAssignment.mockResolvedValue(null);
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
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1", phone: "+972501111111", isAdmin: false } as never);
    mockFindFirstAssignment.mockResolvedValue(null);
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
