import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/api/admin-guard", () => ({
  requireAdmin: vi.fn(),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockFindUsers = vi.mocked(prisma.user.findMany);
const mockFindCompanies = vi.mocked(prisma.company.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

function adminSuccess() {
  mockRequireAdmin.mockResolvedValue({
    error: null,
    session: { user: { isAdmin: true } } as never,
  });
}

function adminFailure() {
  mockRequireAdmin.mockResolvedValue({
    error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
    session: null,
  });
}

describe("GET /api/admin/users", () => {
  it("returns 403 for non-admin", async () => {
    adminFailure();

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Unauthorized");
    expect(mockFindUsers).not.toHaveBeenCalled();
  });

  it("returns users with enriched unit names", async () => {
    adminSuccess();

    const users = [
      {
        id: "u1",
        givenName: "Avi",
        familyName: "Cohen",
        email: "avi@example.com",
        phone: "+972501234567",
        rank: "סגן",
        isAdmin: false,
        profileImage: null,
        cycleAssignments: [
          {
            id: "a1",
            role: "platoon_commander",
            unitType: "platoon",
            unitId: "pl-1",
            cycleId: "c1",
            cycle: { name: "Cycle 1", isActive: true },
          },
        ],
      },
    ];
    mockFindUsers.mockResolvedValue(users as never);

    const companies = [
      {
        id: "co-1",
        name: "Company A",
        platoons: [
          {
            id: "pl-1",
            name: "Platoon 1",
            squads: [{ id: "sq-1", name: "Squad 1" }],
          },
        ],
      },
    ];
    mockFindCompanies.mockResolvedValue(companies as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("u1");
    expect(body[0].cycleAssignments[0].unitName).toBe("Company A / Platoon 1");
  });

  it("returns empty unit name for unknown unit IDs", async () => {
    adminSuccess();

    const users = [
      {
        id: "u1",
        givenName: "Avi",
        familyName: "Cohen",
        email: "avi@example.com",
        phone: null,
        rank: null,
        isAdmin: false,
        profileImage: null,
        cycleAssignments: [
          {
            id: "a1",
            role: "squad_commander",
            unitType: "squad",
            unitId: "unknown-id",
            cycleId: "c1",
            cycle: { name: "Cycle 1", isActive: true },
          },
        ],
      },
    ];
    mockFindUsers.mockResolvedValue(users as never);
    mockFindCompanies.mockResolvedValue([] as never);

    const res = await GET();
    const body = await res.json();

    expect(body[0].cycleAssignments[0].unitName).toBe("");
  });

  it("builds full path for squad unit names", async () => {
    adminSuccess();

    const users = [
      {
        id: "u1",
        givenName: "Test",
        familyName: "User",
        email: "t@e.com",
        phone: null,
        rank: null,
        isAdmin: false,
        profileImage: null,
        cycleAssignments: [
          {
            id: "a1",
            role: "squad_commander",
            unitType: "squad",
            unitId: "sq-1",
            cycleId: "c1",
            cycle: { name: "Cycle 1", isActive: true },
          },
        ],
      },
    ];
    mockFindUsers.mockResolvedValue(users as never);
    mockFindCompanies.mockResolvedValue([
      {
        id: "co-1",
        name: "Alpha",
        platoons: [
          {
            id: "pl-1",
            name: "Bravo",
            squads: [{ id: "sq-1", name: "Charlie" }],
          },
        ],
      },
    ] as never);

    const res = await GET();
    const body = await res.json();

    expect(body[0].cycleAssignments[0].unitName).toBe("Alpha / Bravo / Charlie");
  });
});
