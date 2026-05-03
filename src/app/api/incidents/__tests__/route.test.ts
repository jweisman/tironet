import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    soldier: { findUnique: vi.fn() },
    incident: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { createMockRequest, mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockSoldierFindUnique = vi.mocked(prisma.soldier.findUnique);
const mockIncidentCreate = vi.mocked(prisma.incident.create);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/incidents", () => {
  const validBody = {
    soldierId: "550e8400-e29b-41d4-a716-446655440001",
    type: "commendation",
    subtype: "general",
    date: "2026-05-01",
    description: "Outstanding performance",
    createdByName: "User Test",
    createdByUserId: "550e8400-e29b-41d4-a716-446655440002",
  };

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const req = createMockRequest("POST", "/api/incidents", validBody);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid input", async () => {
    mockAuth.mockResolvedValue({ user: mockSessionUser() } as never);
    const req = createMockRequest("POST", "/api/incidents", { soldierId: "bad" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when soldier not found", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [mockAssignment()] }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue(null as never);

    const req = createMockRequest("POST", "/api/incidents", validBody);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no assignment for soldier's cycle", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({ cycleAssignments: [] }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({ cycleId: "cycle-1", squadId: "squad-1" } as never);

    const req = createMockRequest("POST", "/api/incidents", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when soldier is not in scope", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "other-squad" })],
      }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({ cycleId: "cycle-1", squadId: "squad-1" } as never);

    const req = createMockRequest("POST", "/api/incidents", validBody);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("creates incident when squad commander owns the squad", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({ cycleId: "cycle-1", squadId: "squad-1" } as never);
    mockIncidentCreate.mockResolvedValue({ id: "inc-1" } as never);

    const req = createMockRequest("POST", "/api/incidents", validBody);
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockIncidentCreate).toHaveBeenCalledOnce();
  });

  it("accepts client-generated id", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({ cycleId: "cycle-1", squadId: "squad-1" } as never);
    mockIncidentCreate.mockResolvedValue({ id: "client-id" } as never);

    const clientId = "550e8400-e29b-41d4-a716-446655440000";
    const req = createMockRequest("POST", "/api/incidents", { ...validBody, id: clientId });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockIncidentCreate.mock.calls[0][0].data).toHaveProperty("id", clientId);
  });

  it("accepts discipline and safety types", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({ cycleId: "cycle-1", squadId: "squad-1" } as never);
    mockIncidentCreate.mockResolvedValue({ id: "inc-1" } as never);

    for (const type of ["discipline", "safety"]) {
      const req = createMockRequest("POST", "/api/incidents", { ...validBody, type });
      const res = await POST(req);
      expect(res.status).toBe(201);
    }
  });

  it("rejects legacy infraction type", async () => {
    mockAuth.mockResolvedValue({ user: mockSessionUser() } as never);
    const req = createMockRequest("POST", "/api/incidents", { ...validBody, type: "infraction" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("persists subtype when provided", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({ cycleId: "cycle-1", squadId: "squad-1" } as never);
    mockIncidentCreate.mockResolvedValue({ id: "inc-1" } as never);

    const req = createMockRequest("POST", "/api/incidents", { ...validBody, subtype: "fitness" });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockIncidentCreate.mock.calls[0][0].data).toHaveProperty("subtype", "fitness");
  });

  it("rejects when subtype is omitted", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { subtype: _, ...bodyWithoutSubtype } = validBody;
    const req = createMockRequest("POST", "/api/incidents", bodyWithoutSubtype);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects when subtype is empty string", async () => {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);

    const req = createMockRequest("POST", "/api/incidents", { ...validBody, subtype: "" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
