import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    soldier: { findMany: vi.fn() },
    squad: { findMany: vi.fn(), findUnique: vi.fn() },
    platoon: { findMany: vi.fn() },
  },
}));

import { getRequestScope } from "../request-scope";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRequestScope", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.user).toBeNull();
    expect(result.error!.status).toBe(401);
  });

  it("scopes admin by cycle assignment, not isAdmin flag", async () => {
    const user = mockSessionUser({
      isAdmin: true,
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "platoon_commander",
          unitType: "platoon",
          unitId: "pl-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.squad.findMany.mockResolvedValue([
      { id: "sq-1" },
      { id: "sq-2" },
    ] as never);
    mockPrisma.soldier.findMany.mockResolvedValue([
      { id: "sol-1" },
      { id: "sol-2" },
    ] as never);

    const result = await getRequestScope("cycle-1");
    expect(result.error).toBeNull();
    expect(result.scope!.role).toBe("platoon_commander");
    expect(result.scope!.soldierIds).toEqual(["sol-1", "sol-2"]);
    expect(result.scope!.squadIds).toEqual(["sq-1", "sq-2"]);
    expect(result.scope!.platoonIds).toEqual(["pl-1"]);
    expect(result.scope!.canCreate).toBe(true);
  });

  it("returns 403 for admin without cycle assignment", async () => {
    const user = mockSessionUser({ isAdmin: true });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("returns 403 when user has no assignment for cycle", async () => {
    const user = mockSessionUser({
      cycleAssignments: [mockAssignment({ cycleId: "other-cycle" })],
    });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("resolves squad_commander scope", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "squad_commander",
          unitType: "squad",
          unitId: "sq-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.squad.findUnique.mockResolvedValue({
      id: "sq-1",
      platoonId: "pl-1",
    } as never);
    mockPrisma.soldier.findMany.mockResolvedValue([
      { id: "sol-1" },
      { id: "sol-2" },
    ] as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope!.role).toBe("squad_commander");
    expect(result.scope!.soldierIds).toEqual(["sol-1", "sol-2"]);
    expect(result.scope!.squadIds).toEqual(["sq-1"]);
    expect(result.scope!.platoonIds).toEqual(["pl-1"]);
    expect(result.scope!.canCreate).toBe(true);
  });

  it("returns 404 when squad not found", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "squad_commander",
          unitType: "squad",
          unitId: "sq-missing",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.squad.findUnique.mockResolvedValue(null as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(404);
  });

  it("resolves platoon_commander scope with soldiers from all squads", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "platoon_commander",
          unitType: "platoon",
          unitId: "pl-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.squad.findMany.mockResolvedValue([
      { id: "sq-1" },
      { id: "sq-2" },
    ] as never);
    mockPrisma.soldier.findMany.mockResolvedValue([
      { id: "sol-1" },
      { id: "sol-2" },
      { id: "sol-3" },
    ] as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope!.role).toBe("platoon_commander");
    expect(result.scope!.soldierIds).toEqual(["sol-1", "sol-2", "sol-3"]);
    expect(result.scope!.squadIds).toEqual(["sq-1", "sq-2"]);
    expect(result.scope!.platoonIds).toEqual(["pl-1"]);
    expect(result.scope!.canCreate).toBe(true);
  });

  it("resolves company_commander scope (canCreate = false)", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "company_commander",
          unitType: "company",
          unitId: "co-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.platoon.findMany.mockResolvedValue([
      { id: "pl-1" },
      { id: "pl-2" },
    ] as never);
    mockPrisma.squad.findMany.mockResolvedValue([
      { id: "sq-1" },
      { id: "sq-2" },
    ] as never);
    mockPrisma.soldier.findMany.mockResolvedValue([
      { id: "sol-1" },
    ] as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope!.role).toBe("company_commander");
    expect(result.scope!.platoonIds).toEqual(["pl-1", "pl-2"]);
    expect(result.scope!.canCreate).toBe(false);
  });

  it("resolves company_medic scope: company-level, canCreate = true", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "company_medic",
          unitType: "company",
          unitId: "co-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.platoon.findMany.mockResolvedValue([
      { id: "pl-1" },
      { id: "pl-2" },
    ] as never);
    mockPrisma.squad.findMany.mockResolvedValue([
      { id: "sq-1" },
      { id: "sq-2" },
      { id: "sq-3" },
    ] as never);
    mockPrisma.soldier.findMany.mockResolvedValue([
      { id: "sol-1" },
      { id: "sol-2" },
    ] as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope!.role).toBe("company_medic");
    expect(result.scope!.platoonIds).toEqual(["pl-1", "pl-2"]);
    expect(result.scope!.squadIds).toEqual(["sq-1", "sq-2", "sq-3"]);
    expect(result.scope!.soldierIds).toEqual(["sol-1", "sol-2"]);
    expect(result.scope!.canCreate).toBe(true);
  });

  it("returns 403 for instructor (no request access)", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "instructor",
          unitType: "company",
          unitId: "co-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getRequestScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });
});
