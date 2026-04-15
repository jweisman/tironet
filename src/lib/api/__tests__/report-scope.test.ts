import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    platoon: {
      findMany: vi.fn(),
    },
  },
}));

import { getReportScope } from "../report-scope";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getReportScope", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.user).toBeNull();
    expect(result.error!.status).toBe(401);
  });

  it("returns 403 when user has no assignment for cycle", async () => {
    const user = mockSessionUser({
      cycleAssignments: [mockAssignment({ cycleId: "other-cycle" })],
    });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("returns 403 for admin without cycle assignment", async () => {
    const user = mockSessionUser({ isAdmin: true });
    mockAuth.mockResolvedValue({ user } as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("returns 403 for squad_commander", async () => {
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

    const result = await getReportScope("cycle-1");
    expect(result.scope).toBeNull();
    expect(result.error!.status).toBe(403);
  });

  it("resolves platoon_commander scope", async () => {
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

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("platoon_commander");
    expect(result.scope!.platoonIds).toEqual(["pl-1"]);
    expect(result.scope!.companyId).toBeUndefined();
  });

  it("resolves company_commander scope with all platoons", async () => {
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

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("company_commander");
    expect(result.scope!.platoonIds).toEqual(["pl-1", "pl-2"]);
    expect(result.scope!.companyId).toBe("co-1");
  });

  it("resolves deputy_company_commander as company_commander", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "deputy_company_commander",
          unitType: "company",
          unitId: "co-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.platoon.findMany.mockResolvedValue([
      { id: "pl-1" },
    ] as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("company_commander");
    expect(result.scope!.platoonIds).toEqual(["pl-1"]);
    expect(result.scope!.companyId).toBe("co-1");
  });

  it("resolves instructor scope: company-level with platoons", async () => {
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
    mockPrisma.platoon.findMany.mockResolvedValue([
      { id: "pl-1" },
      { id: "pl-2" },
    ] as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("instructor");
    expect(result.scope!.platoonIds).toEqual(["pl-1", "pl-2"]);
    expect(result.scope!.companyId).toBe("co-1");
  });

  it("resolves company_medic scope: company-level with platoons", async () => {
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
      { id: "pl-3" },
    ] as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("company_medic");
    expect(result.scope!.platoonIds).toEqual(["pl-1", "pl-3"]);
    expect(result.scope!.companyId).toBe("co-1");
  });

  it("resolves hardship_coordinator scope: company-level with platoons", async () => {
    const user = mockSessionUser({
      cycleAssignments: [
        mockAssignment({
          cycleId: "cycle-1",
          role: "hardship_coordinator",
          unitType: "company",
          unitId: "co-1",
        }),
      ],
    });
    mockAuth.mockResolvedValue({ user } as never);
    mockPrisma.platoon.findMany.mockResolvedValue([
      { id: "pl-1" },
      { id: "pl-3" },
    ] as never);

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("hardship_coordinator");
    expect(result.scope!.platoonIds).toEqual(["pl-1", "pl-3"]);
    expect(result.scope!.companyId).toBe("co-1");
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

    const result = await getReportScope("cycle-1");
    expect(result.scope!.role).toBe("platoon_commander");
    expect(result.scope!.platoonIds).toEqual(["pl-1"]);
  });
});
