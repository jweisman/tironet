import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    incident: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
const mockIncidentFindUnique = vi.mocked(prisma.incident.findUnique);
const mockIncidentUpdate = vi.mocked(prisma.incident.update);
const mockIncidentDelete = vi.mocked(prisma.incident.delete);
const mockSquadFindUnique = vi.mocked(prisma.squad.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
});

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const existingIncident = {
  soldierId: "soldier-1",
  soldier: { cycleId: "cycle-1", squadId: "squad-1" },
};

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe("PATCH /api/incidents/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("PATCH", "/api/incidents/inc-1", { description: "updated" });
    const res = await PATCH(req, makeParams("inc-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when incident not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("PATCH", "/api/incidents/inc-1", { description: "updated" });
    const res = await PATCH(req, makeParams("inc-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when squad commander tries to edit", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(existingIncident as never);

    const req = createMockRequest("PATCH", "/api/incidents/inc-1", { description: "updated" });
    const res = await PATCH(req, makeParams("inc-1"));
    expect(res.status).toBe(403);
  });

  it("allows platoon commander to edit", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(existingIncident as never);
    mockSquadFindUnique.mockResolvedValue({ platoonId: "platoon-1" } as never);
    mockIncidentUpdate.mockResolvedValue({ id: "inc-1" } as never);

    const req = createMockRequest("PATCH", "/api/incidents/inc-1", { description: "updated" });
    const res = await PATCH(req, makeParams("inc-1"));
    expect(res.status).toBe(200);
    expect(mockIncidentUpdate).toHaveBeenCalledOnce();
  });

  it("returns 403 when platoon commander is out of scope", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ unitId: "other-platoon" })],
      }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(existingIncident as never);
    mockSquadFindUnique.mockResolvedValue({ platoonId: "platoon-1" } as never);

    const req = createMockRequest("PATCH", "/api/incidents/inc-1", { description: "updated" });
    const res = await PATCH(req, makeParams("inc-1"));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe("DELETE /api/incidents/[id]", () => {
  it("returns 200 when incident not found (idempotent)", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("DELETE", "/api/incidents/inc-1");
    const res = await DELETE(req, makeParams("inc-1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 when squad commander tries to delete", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(existingIncident as never);

    const req = createMockRequest("DELETE", "/api/incidents/inc-1");
    const res = await DELETE(req, makeParams("inc-1"));
    expect(res.status).toBe(403);
  });

  it("allows platoon commander to delete", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockIncidentFindUnique.mockResolvedValue(existingIncident as never);
    mockSquadFindUnique.mockResolvedValue({ platoonId: "platoon-1" } as never);
    mockIncidentDelete.mockResolvedValue({ id: "inc-1" } as never);

    const req = createMockRequest("DELETE", "/api/incidents/inc-1");
    const res = await DELETE(req, makeParams("inc-1"));
    expect(res.status).toBe(204);
    expect(mockIncidentDelete).toHaveBeenCalledOnce();
  });
});
