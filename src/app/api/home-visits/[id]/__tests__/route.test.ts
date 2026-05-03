import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    homeVisit: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    squad: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { PATCH, DELETE } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest, mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockHomeVisitFindUnique = vi.mocked(prisma.homeVisit.findUnique);
const mockHomeVisitUpdate = vi.mocked(prisma.homeVisit.update);
const mockHomeVisitDelete = vi.mocked(prisma.homeVisit.delete);
const mockSquadFindUnique = vi.mocked(prisma.squad.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
});

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const existingVisit = {
  soldierId: "soldier-1",
  soldier: { cycleId: "cycle-1", squadId: "squad-1" },
};

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe("PATCH /api/home-visits/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("PATCH", "/api/home-visits/hv-1", { status: "deficiencies" });
    const res = await PATCH(req, makeParams("hv-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when visit not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockHomeVisitFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/home-visits/hv-1", { status: "deficiencies" });
    const res = await PATCH(req, makeParams("hv-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when squad commander tries to edit", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockHomeVisitFindUnique.mockResolvedValue(existingVisit as never);

    const req = createMockRequest("PATCH", "/api/home-visits/hv-1", { status: "deficiencies" });
    const res = await PATCH(req, makeParams("hv-1"));
    expect(res.status).toBe(403);
  });

  it("allows platoon commander to edit", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockHomeVisitFindUnique.mockResolvedValue(existingVisit as never);
    mockSquadFindUnique.mockResolvedValue({ platoonId: "platoon-1" } as never);
    mockHomeVisitUpdate.mockResolvedValue({ id: "hv-1" } as never);

    const req = createMockRequest("PATCH", "/api/home-visits/hv-1", { status: "deficiencies" });
    const res = await PATCH(req, makeParams("hv-1"));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe("DELETE /api/home-visits/[id]", () => {
  it("returns 200 when visit not found (idempotent)", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockHomeVisitFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("DELETE", "/api/home-visits/hv-1");
    const res = await DELETE(req, makeParams("hv-1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 when squad commander tries to delete", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockHomeVisitFindUnique.mockResolvedValue(existingVisit as never);

    const req = createMockRequest("DELETE", "/api/home-visits/hv-1");
    const res = await DELETE(req, makeParams("hv-1"));
    expect(res.status).toBe(403);
  });

  it("allows platoon commander to delete", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockHomeVisitFindUnique.mockResolvedValue(existingVisit as never);
    mockSquadFindUnique.mockResolvedValue({ platoonId: "platoon-1" } as never);
    mockHomeVisitDelete.mockResolvedValue({ id: "hv-1" } as never);

    const req = createMockRequest("DELETE", "/api/home-visits/hv-1");
    const res = await DELETE(req, makeParams("hv-1"));
    expect(res.status).toBe(204);
  });
});
