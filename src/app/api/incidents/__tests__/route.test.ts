import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    soldier: { findUnique: vi.fn() },
    incident: { create: vi.fn() },
    userCycleAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

// Track promises returned by the after() callback so tests can await them.
const afterPromises: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      const result = fn();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        afterPromises.push(result as Promise<unknown>);
      }
    }),
  };
});

async function flushAfter() {
  await Promise.allSettled(afterPromises.splice(0));
}

vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { sendPushToUsers } from "@/lib/push/send";
import { createMockRequest, mockSessionUser, mockAssignment } from "@/__tests__/helpers/api";

const mockAuth = vi.mocked(auth);
const mockSoldierFindUnique = vi.mocked(prisma.soldier.findUnique);
const mockIncidentCreate = vi.mocked(prisma.incident.create);
const mockAssignmentFindMany = vi.mocked(prisma.userCycleAssignment.findMany);
const mockSendPushToUsers = vi.mocked(sendPushToUsers);

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
    // First findUnique call returns scope info; second (from notification) returns soldier name + chain.
    mockSoldierFindUnique.mockResolvedValue({
      cycleId: "cycle-1",
      squadId: "squad-1",
      familyName: "Cohen",
      givenName: "Avi",
      squad: { platoonId: "platoon-1", platoon: { companyId: "company-1" } },
    } as never);
    mockAssignmentFindMany.mockResolvedValue([]);
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

// ---------------------------------------------------------------------------
// Severe-incident push notifications (#205)
// ---------------------------------------------------------------------------
describe("POST /api/incidents — severe-incident notifications", () => {
  const creatorId = "550e8400-e29b-41d4-a716-446655440002";
  const soldierId = "550e8400-e29b-41d4-a716-446655440001";
  const baseBody = {
    soldierId,
    subtype: "general",
    date: "2026-05-01",
    description: "Test description",
    createdByName: "User Test",
    createdByUserId: creatorId,
  };

  function authedSquadCommander() {
    mockAuth.mockResolvedValue({
      user: mockSessionUser({
        cycleAssignments: [mockAssignment({ role: "squad_commander" as never, unitType: "squad", unitId: "squad-1" })],
      }),
    } as never);
    mockSoldierFindUnique.mockResolvedValue({
      cycleId: "cycle-1",
      squadId: "squad-1",
      familyName: "Cohen",
      givenName: "Avi",
      squad: { platoonId: "platoon-1", platoon: { companyId: "company-1" } },
    } as never);
    mockIncidentCreate.mockResolvedValue({ id: "inc-1" } as never);
  }

  it("does NOT notify for commendation type", async () => {
    authedSquadCommander();
    mockAssignmentFindMany.mockResolvedValue([{ userId: "u-platoon" }] as never);

    const req = createMockRequest("POST", "/api/incidents", { ...baseBody, type: "commendation" });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockSendPushToUsers).not.toHaveBeenCalled();
  });

  it("notifies up the chain for safety incidents and excludes the creator", async () => {
    authedSquadCommander();
    mockAssignmentFindMany.mockResolvedValue([
      { userId: "u-platoon" },
      { userId: "u-company" },
      { userId: creatorId }, // should be filtered out
    ] as never);

    const req = createMockRequest("POST", "/api/incidents", { ...baseBody, type: "safety" });
    const res = await POST(req);
    await flushAfter();
    expect(res.status).toBe(201);
    expect(mockSendPushToUsers).toHaveBeenCalledOnce();
    const [userIds, payload, prefField] = mockSendPushToUsers.mock.calls[0];
    expect(userIds).toEqual(["u-platoon", "u-company"]);
    expect(payload.title).toBe("אירוע בטיחות");
    expect(payload.body).toBe("אירוע בטיחות נוסף לCohen Avi");
    expect(payload.url).toBe(`/soldiers/${soldierId}`);
    expect(prefField).toBe("severeIncidentEnabled");
  });

  it("uses correct type label for discipline incidents", async () => {
    authedSquadCommander();
    mockAssignmentFindMany.mockResolvedValue([{ userId: "u-platoon" }] as never);

    const req = createMockRequest("POST", "/api/incidents", { ...baseBody, type: "discipline" });
    const res = await POST(req);
    await flushAfter();
    expect(res.status).toBe(201);
    expect(mockSendPushToUsers).toHaveBeenCalledOnce();
    const [, payload] = mockSendPushToUsers.mock.calls[0];
    expect(payload.title).toBe("אירוע משמעת");
    expect(payload.body).toBe("אירוע משמעת נוסף לCohen Avi");
  });

  it("queries chain-of-command roles via UserCycleAssignment", async () => {
    authedSquadCommander();
    mockAssignmentFindMany.mockResolvedValue([] as never);

    const req = createMockRequest("POST", "/api/incidents", { ...baseBody, type: "discipline" });
    await POST(req);
    await flushAfter();

    expect(mockAssignmentFindMany).toHaveBeenCalledOnce();
    const where = mockAssignmentFindMany.mock.calls[0][0]!.where as {
      OR: Array<{ unitId: string; role: unknown }>;
      cycle: { isActive: boolean };
    };
    expect(where.cycle).toEqual({ isActive: true });
    expect(where.OR).toHaveLength(3);
    expect(where.OR[0]).toMatchObject({ unitId: "squad-1", role: "squad_commander" });
    expect(where.OR[1]).toMatchObject({ unitId: "platoon-1" });
    expect(where.OR[2]).toMatchObject({ unitId: "company-1" });
  });

  it("does not invoke sendPushToUsers when only the creator is in scope", async () => {
    authedSquadCommander();
    mockAssignmentFindMany.mockResolvedValue([{ userId: creatorId }] as never);

    const req = createMockRequest("POST", "/api/incidents", { ...baseBody, type: "safety" });
    const res = await POST(req);
    await flushAfter();
    expect(res.status).toBe(201);
    expect(mockSendPushToUsers).not.toHaveBeenCalled();
  });

});
