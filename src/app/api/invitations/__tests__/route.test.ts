import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    invitation: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cycle: { findUnique: vi.fn() },
    platoon: { findUnique: vi.fn() },
    squad: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    userCycleAssignment: { create: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: () => null }),
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn(() => ({
      toString: () => "mock-token-hex",
    })),
  };
});

import { POST as CreateInvitation } from "../route";
import { GET as GetByToken } from "../[token]/route";
import { POST as AcceptInvitation } from "../[token]/accept/route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest, mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockInvitationCreate = vi.mocked(prisma.invitation.create);
const mockInvitationFindUnique = vi.mocked(prisma.invitation.findUnique);
const mockCycleFindUnique = vi.mocked(prisma.cycle.findUnique);
const mockPlatoonFindUnique = vi.mocked(prisma.platoon.findUnique);
const mockSquadFindUnique = vi.mocked(prisma.squad.findUnique);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockUserFindFirst = vi.mocked(prisma.user.findFirst);
const mockAssignmentFindUnique = vi.mocked(prisma.userCycleAssignment.findUnique);
const mockAssignmentCreate = vi.mocked(prisma.userCycleAssignment.create);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockCompanyFindUnique = vi.mocked(prisma.company.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  // Default: no existing user found (so invitation flow proceeds)
  mockUserFindFirst.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// POST /api/invitations (create invitation)
// ---------------------------------------------------------------------------
describe("POST /api/invitations (create)", () => {
  const validBody = {
    email: "invitee@example.com",
    cycleId: "c1c1c1c1-c1c1-4c1c-81c1-c1c1c1c1c1c1",
    role: "squad_commander",
    unitType: "squad",
    unitId: "a1a1a1a1-a1a1-4a1a-81a1-a1a1a1a1a1a1",
    givenName: "Dan",
    familyName: "Levi",
  };

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);

    expect(res.status).toBe(401);
  });

  it("returns 400 when neither email nor phone provided", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);

    const req = createMockRequest("POST", "/api/invitations", {
      cycleId: validBody.cycleId,
      role: "squad_commander",
      unitType: "squad",
      unitId: validBody.unitId,
    });

    const res = await CreateInvitation(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid phone number", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);

    const req = createMockRequest("POST", "/api/invitations", {
      ...validBody,
      email: undefined,
      phone: "12345", // invalid
    });

    const res = await CreateInvitation(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when non-admin lacks role hierarchy", async () => {
    // squad_commander trying to invite another squad_commander (same level)
    const user = mockSessionUser({
      isAdmin: false,
      cycleAssignments: [
        mockAssignment({
          cycleId: validBody.cycleId,
          role: "squad_commander",
          unitType: "squad",
          unitId: "other-squad",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);

    expect(res.status).toBe(403);
  });

  it("returns 403 when platoon_commander invites for wrong platoon", async () => {
    const user = mockSessionUser({
      isAdmin: false,
      cycleAssignments: [
        mockAssignment({
          cycleId: validBody.cycleId,
          role: "platoon_commander",
          unitType: "platoon",
          unitId: "pl-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    // The squad belongs to a different platoon
    mockSquadFindUnique.mockResolvedValue({ platoonId: "pl-2" } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);

    expect(res.status).toBe(403);
  });

  it("allows platoon_commander to invite squad_commander in their platoon", async () => {
    const user = mockSessionUser({
      isAdmin: false,
      cycleAssignments: [
        mockAssignment({
          cycleId: validBody.cycleId,
          role: "platoon_commander",
          unitType: "platoon",
          unitId: "pl-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockSquadFindUnique.mockResolvedValue({ platoonId: "pl-1" } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockInvitationCreate.mockResolvedValue({ id: "inv-new" } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("inv-new");
    expect(body.inviteUrl).toContain("/invite/");
  });

  it("admin can create invitation without hierarchy check", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockInvitationCreate.mockResolvedValue({ id: "inv-new" } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("inv-new");
    expect(mockInvitationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "invitee@example.com",
        phone: null,
        role: "squad_commander",
        unitType: "squad",
        unitId: validBody.unitId,
        cycleId: validBody.cycleId,
        givenName: "Dan",
        familyName: "Levi",
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("normalizes phone to E.164 when provided", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockInvitationCreate.mockResolvedValue({ id: "inv-new" } as never);

    const req = createMockRequest("POST", "/api/invitations", {
      ...validBody,
      email: undefined,
      phone: "050-123-4567",
    });
    const res = await CreateInvitation(req);

    expect(res.status).toBe(201);
    expect(mockInvitationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: "+972501234567",
        email: null,
      }),
    });
  });

  it("allows company_commander to invite platoon_commander in their company (platoon unit)", async () => {
    const platoonUnitId = "b2b2b2b2-b2b2-4b2b-82b2-b2b2b2b2b2b2";
    const user = mockSessionUser({
      isAdmin: false,
      cycleAssignments: [
        mockAssignment({
          cycleId: validBody.cycleId,
          role: "company_commander",
          unitType: "company",
          unitId: "comp-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    // isAuthorizedToInvite: company_commander inviting platoon_commander for a platoon
    mockPlatoonFindUnique.mockResolvedValue({ companyId: "comp-1" } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockInvitationCreate.mockResolvedValue({ id: "inv-new" } as never);

    const req = createMockRequest("POST", "/api/invitations", {
      ...validBody,
      role: "platoon_commander",
      unitType: "platoon",
      unitId: platoonUnitId,
    });
    const res = await CreateInvitation(req);
    expect(res.status).toBe(201);
  });

  it("allows company_commander to invite squad_commander in their company (squad unit)", async () => {
    const user = mockSessionUser({
      isAdmin: false,
      cycleAssignments: [
        mockAssignment({
          cycleId: validBody.cycleId,
          role: "company_commander",
          unitType: "company",
          unitId: "comp-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    // isAuthorizedToInvite: company_commander inviting squad_commander for a squad
    mockSquadFindUnique.mockResolvedValue({
      platoon: { companyId: "comp-1" },
    } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockInvitationCreate.mockResolvedValue({ id: "inv-new" } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);
    expect(res.status).toBe(201);
  });

  it("rejects company_commander inviting squad_commander in different company", async () => {
    const user = mockSessionUser({
      isAdmin: false,
      cycleAssignments: [
        mockAssignment({
          cycleId: validBody.cycleId,
          role: "company_commander",
          unitType: "company",
          unitId: "comp-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    // Squad belongs to a different company
    mockSquadFindUnique.mockResolvedValue({
      platoon: { companyId: "comp-other" },
    } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when cycle not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockCycleFindUnique.mockResolvedValue(null);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);

    expect(res.status).toBe(404);
  });

  it("creates direct assignment when user with matching email already exists", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockUserFindFirst.mockResolvedValue({
      id: "existing-user-id",
      givenName: "Existing",
      familyName: "User",
    } as never);
    mockAssignmentFindUnique.mockResolvedValue(null); // no existing assignment
    mockAssignmentCreate.mockResolvedValue({ id: "new-assignment-id" } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.assigned).toBe(true);
    expect(body.userName).toBe("Existing User");
    expect(mockInvitationCreate).not.toHaveBeenCalled();
    expect(mockAssignmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "existing-user-id",
        cycleId: validBody.cycleId,
        role: "squad_commander",
        unitType: "squad",
        unitId: validBody.unitId,
      }),
    });
  });

  it("returns 409 when existing user already has assignment in cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ isAdmin: true }),
    } as never);
    mockCycleFindUnique.mockResolvedValue({ name: "Cycle 1" } as never);
    mockUserFindFirst.mockResolvedValue({
      id: "existing-user-id",
      givenName: "Existing",
      familyName: "User",
    } as never);
    mockAssignmentFindUnique.mockResolvedValue({ id: "existing-assignment" } as never);

    const req = createMockRequest("POST", "/api/invitations", validBody);
    const res = await CreateInvitation(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("שיבוץ");
    expect(mockInvitationCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/invitations/[token]
// ---------------------------------------------------------------------------
describe("GET /api/invitations/[token]", () => {
  const tokenParams = { params: Promise.resolve({ token: "valid-token" }) };

  it("returns 404 when token not found", async () => {
    mockInvitationFindUnique.mockResolvedValue(null);

    const req = createMockRequest("GET", "/api/invitations/valid-token");
    const res = await GetByToken(req, tokenParams);

    expect(res.status).toBe(404);
  });

  it("returns 410 when invitation already accepted", async () => {
    mockInvitationFindUnique.mockResolvedValue({
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      cycle: { name: "C1" },
    } as never);

    const req = createMockRequest("GET", "/api/invitations/valid-token");
    const res = await GetByToken(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toBe("already_used");
  });

  it("returns 410 when invitation expired", async () => {
    mockInvitationFindUnique.mockResolvedValue({
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1000), // expired
      cycle: { name: "C1" },
    } as never);

    const req = createMockRequest("GET", "/api/invitations/valid-token");
    const res = await GetByToken(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toBe("expired");
  });

  it("returns invitation metadata for valid token (platoon unit)", async () => {
    mockInvitationFindUnique.mockResolvedValue({
      email: "invitee@example.com",
      role: "platoon_commander",
      unitType: "platoon",
      unitId: "pl-1",
      cycleId: "c1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycle: { name: "Cycle 1" },
    } as never);
    mockPlatoonFindUnique.mockResolvedValue({ name: "Platoon 1" } as never);

    const req = createMockRequest("GET", "/api/invitations/valid-token");
    const res = await GetByToken(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBe("invitee@example.com");
    expect(body.role).toBe("platoon_commander");
    expect(body.unitName).toBe("Platoon 1");
    expect(body.cycleName).toBe("Cycle 1");
    expect(body.expiresAt).toBeDefined();
  });

  it("resolves company unit name for company type invitation", async () => {
    mockInvitationFindUnique.mockResolvedValue({
      email: "invitee@example.com",
      role: "company_commander",
      unitType: "company",
      unitId: "comp-1",
      cycleId: "c1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycle: { name: "Cycle 1" },
    } as never);
    mockCompanyFindUnique.mockResolvedValue({ name: "Company Alpha" } as never);

    const req = createMockRequest("GET", "/api/invitations/valid-token");
    const res = await GetByToken(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unitName).toBe("Company Alpha");
  });

  it("resolves squad unit name for squad type invitation", async () => {
    mockInvitationFindUnique.mockResolvedValue({
      email: "invitee@example.com",
      role: "squad_commander",
      unitType: "squad",
      unitId: "sq-1",
      cycleId: "c1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycle: { name: "Cycle 1" },
    } as never);
    mockSquadFindUnique.mockResolvedValue({ name: "Squad Bravo" } as never);

    const req = createMockRequest("GET", "/api/invitations/valid-token");
    const res = await GetByToken(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unitName).toBe("Squad Bravo");
  });
});

// ---------------------------------------------------------------------------
// POST /api/invitations/[token]/accept
// ---------------------------------------------------------------------------
describe("POST /api/invitations/[token]/accept", () => {
  const tokenParams = { params: Promise.resolve({ token: "accept-token" }) };

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);

    expect(res.status).toBe(401);
  });

  it("returns 404 when invitation not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser(),
    } as never);
    mockInvitationFindUnique.mockResolvedValue(null);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);

    expect(res.status).toBe(404);
  });

  it("returns 410 when invitation already accepted", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser(),
    } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    } as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);

    expect(res.status).toBe(410);
  });

  it("returns 410 when invitation expired", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser(),
    } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);

    expect(res.status).toBe(410);
  });

  it("returns 403 when email does not match", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ email: "other@example.com" }),
    } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "invitee@example.com",
      phone: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    } as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("email_mismatch");
  });

  it("returns 403 when phone does not match (phone-only invitation)", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: null,
      phone: "+972501234567",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    } as never);
    // User has a different phone
    mockUserFindUnique.mockResolvedValueOnce({ phone: "+972509999999" } as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("phone_mismatch");
  });

  it("successfully accepts invitation and creates assignment", async () => {
    const user = mockSessionUser({ email: "invitee@example.com", id: "user-1" });
    mockAuth.mockResolvedValue({ user } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "invitee@example.com",
      phone: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycleId: "c1",
      role: "squad_commander",
      unitType: "squad",
      unitId: "s1",
      givenName: null,
      familyName: null,
      rank: undefined,
      profileImage: undefined,
    } as never);
    // Session user exists in DB
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1" } as never);
    mockTransaction.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("returns 401 when session user not in DB (stale JWT)", async () => {
    const user = mockSessionUser({ email: "invitee@example.com", id: "user-1" });
    mockAuth.mockResolvedValue({ user } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "invitee@example.com",
      phone: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycleId: "c1",
      role: "squad_commander",
      unitType: "squad",
      unitId: "s1",
      givenName: null,
      familyName: null,
      rank: undefined,
      profileImage: undefined,
    } as never);
    // Session user does NOT exist in DB
    mockUserFindUnique.mockResolvedValueOnce(null);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("session_invalid");
  });

  it("accepts invitation with profile update including phone", async () => {
    const user = mockSessionUser({ email: "invitee@example.com", id: "user-1" });
    mockAuth.mockResolvedValue({ user } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "invitee@example.com",
      phone: "+972501234567",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycleId: "c1",
      role: "squad_commander",
      unitType: "squad",
      unitId: "s1",
      givenName: "Dan",
      familyName: "Levi",
      rank: "sergeant",
      profileImage: "http://img.jpg",
    } as never);
    // Phone is not owned by another user
    mockUserFindUnique
      .mockResolvedValueOnce(null as never)          // phoneOwner check
      .mockResolvedValueOnce({ id: "user-1" } as never); // session user exists
    mockTransaction.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    expect(res.status).toBe(200);

    // transaction should include profile update with phone
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({}), // assignment create
        expect.objectContaining({}), // invitation update
        expect.objectContaining({}), // user update (profile + phone)
      ])
    );
  });

  it("skips phone in profile update when phone owned by another user", async () => {
    const user = mockSessionUser({ email: "invitee@example.com", id: "user-1" });
    mockAuth.mockResolvedValue({ user } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "invitee@example.com",
      phone: "+972501234567",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycleId: "c1",
      role: "squad_commander",
      unitType: "squad",
      unitId: "s1",
      givenName: "Dan",
      familyName: null,
      rank: undefined,
      profileImage: undefined,
    } as never);
    // Phone is owned by a different user
    mockUserFindUnique
      .mockResolvedValueOnce({ id: "other-user" } as never) // phoneOwner check
      .mockResolvedValueOnce({ id: "user-1" } as never);    // session user exists
    mockTransaction.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    expect(res.status).toBe(200);
  });

  it("rejects phone-only invitation when user has no phone set", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ id: "user-1" }),
    } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: null,
      phone: "+972501234567",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycleId: "c1",
      role: "squad_commander",
      unitType: "squad",
      unitId: "s1",
      givenName: null,
      familyName: null,
      rank: undefined,
      profileImage: undefined,
    } as never);
    // User has no phone (null) — should be rejected
    mockUserFindUnique
      .mockResolvedValueOnce({ phone: null } as never);

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("phone_mismatch");
  });

  it("returns 500 when transaction fails", async () => {
    const user = mockSessionUser({ email: "invitee@example.com", id: "user-1" });
    mockAuth.mockResolvedValue({ user } as never);
    mockInvitationFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "invitee@example.com",
      phone: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      cycleId: "c1",
      role: "squad_commander",
      unitType: "squad",
      unitId: "s1",
      givenName: null,
      familyName: null,
      rank: undefined,
      profileImage: undefined,
    } as never);
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-1" } as never);
    mockTransaction.mockRejectedValue(new Error("DB error"));

    const req = createMockRequest("POST", "/api/invitations/accept-token/accept");
    const res = await AcceptInvitation(req, tokenParams);

    expect(res.status).toBe(500);
  });
});
