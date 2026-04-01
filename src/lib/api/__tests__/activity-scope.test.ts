import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    platoon: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    squad: {
      findUnique: vi.fn(),
    },
  },
}));

import { getActivityScope } from "../activity-scope";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActivityScope", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const result = await getActivityScope("cycle-1");
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
          unitId: "platoon-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.platoon.findUnique.mockResolvedValue({
      id: "platoon-1",
      name: "Platoon A",
    } as never);

    const result = await getActivityScope("cycle-1");
    expect(result.error).toBeNull();
    expect(result.scope!.role).toBe("platoon_commander");
    expect(result.scope!.platoonIds).toEqual(["platoon-1"]);
    expect(result.scope!.canCreate).toBe(true);
    expect(result.scope!.canEditMetadataForPlatoon("platoon-1")).toBe(true);
    expect(result.scope!.canEditMetadataForPlatoon("other")).toBe(false);
  });

  it("returns 403 for admin without cycle assignment", async () => {
    const user = mockSessionUser({ isAdmin: true });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getActivityScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("returns 403 when user has no assignment for cycle", async () => {
    const user = mockSessionUser({
      cycleAssignments: [mockAssignment({ cycleId: "other-cycle" })],
    });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getActivityScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("resolves squad_commander scope via squad lookup", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "squad_commander",
          unitType: "squad",
          unitId: "squad-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.squad.findUnique.mockResolvedValue({
      platoonId: "platoon-1",
    } as never);

    const result = await getActivityScope("cycle-1");
    expect(result.scope!.role).toBe("squad_commander");
    expect(result.scope!.platoonIds).toEqual(["platoon-1"]);
    expect(result.scope!.squadId).toBe("squad-1");
    expect(result.scope!.canCreate).toBe(false);
    expect(result.scope!.canEditMetadataForPlatoon("platoon-1")).toBe(false);
  });

  it("returns 404 when squad not found", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "squad_commander",
          unitType: "squad",
          unitId: "squad-missing",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.squad.findUnique.mockResolvedValue(null as never);

    const result = await getActivityScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(404);
  });

  it("resolves platoon_commander scope", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "platoon_commander",
          unitType: "platoon",
          unitId: "platoon-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.platoon.findUnique.mockResolvedValue({
      id: "platoon-1",
      name: "Platoon A",
    } as never);

    const result = await getActivityScope("cycle-1");
    expect(result.scope!.role).toBe("platoon_commander");
    expect(result.scope!.platoonIds).toEqual(["platoon-1"]);
    expect(result.scope!.platoons).toEqual([{ id: "platoon-1", name: "Platoon A" }]);
    expect(result.scope!.canCreate).toBe(true);
    expect(result.scope!.canEditMetadataForPlatoon("platoon-1")).toBe(true);
    expect(result.scope!.canEditMetadataForPlatoon("other")).toBe(false);
  });

  it("resolves company_commander scope with all platoons", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "company_commander",
          unitType: "company",
          unitId: "company-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);

    const platoons = [
      { id: "p1", name: "P1" },
      { id: "p2", name: "P2" },
    ];
    mockPrisma.platoon.findMany.mockResolvedValue(platoons as never);

    const result = await getActivityScope("cycle-1");
    expect(result.scope!.role).toBe("company_commander");
    expect(result.scope!.platoonIds).toEqual(["p1", "p2"]);
    expect(result.scope!.platoons).toEqual(platoons);
    expect(result.scope!.canCreate).toBe(false);
    expect(result.scope!.canEditMetadataForPlatoon("p1")).toBe(false);
  });
});
