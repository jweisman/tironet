import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userCycleAssignment: { findMany: vi.fn() },
    squad: { findMany: vi.fn() },
    activity: { findMany: vi.fn() },
    soldier: { findMany: vi.fn() },
    activityReport: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUsers } from "@/lib/push/send";
import { NextRequest } from "next/server";

const mockAssignments = vi.mocked(prisma.userCycleAssignment.findMany);
const mockSquads = vi.mocked(prisma.squad.findMany);
const mockActivities = vi.mocked(prisma.activity.findMany);
const mockSoldiers = vi.mocked(prisma.soldier.findMany);
const mockReports = vi.mocked(prisma.activityReport.findMany);
const mockSendPush = vi.mocked(sendPushToUsers);

function makeRequest(secret = "test-secret"): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/daily-tasks", {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-secret");
});

describe("GET /api/cron/daily-tasks", () => {
  it("returns 401 with wrong secret", async () => {
    const res = await GET(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns sent=0 when no squad commanders", async () => {
    mockAssignments.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.sent).toBe(0);
  });

  it("returns sent=0 when no activities", async () => {
    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", cycleId: "cycle-1", cycle: { id: "cycle-1" } },
    ] as never);
    mockSquads.mockResolvedValue([{ id: "squad-1", platoonId: "platoon-1" }] as never);
    mockActivities.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.sent).toBe(0);
  });

  it("sends notification when there are missing reports", async () => {
    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", cycleId: "cycle-1", cycle: { id: "cycle-1" } },
    ] as never);
    mockSquads.mockResolvedValue([{ id: "squad-1", platoonId: "platoon-1" }] as never);
    mockActivities.mockResolvedValue([
      { id: "act-1", platoonId: "platoon-1", cycleId: "cycle-1" },
    ] as never);
    mockSoldiers.mockResolvedValue([
      { id: "sol-1", squadId: "squad-1" },
      { id: "sol-2", squadId: "squad-1" },
    ] as never);
    // Only one report exists — one soldier is missing
    mockReports.mockResolvedValue([
      { activityId: "act-1", soldierId: "sol-1" },
    ] as never);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      ["user-1"],
      expect.objectContaining({
        title: "דיווחי פעילויות חסרים",
        url: "/activities?filter=gaps",
      }),
      "dailyTasksEnabled",
    );
  });

  it("does not send when all reports exist", async () => {
    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", cycleId: "cycle-1", cycle: { id: "cycle-1" } },
    ] as never);
    mockSquads.mockResolvedValue([{ id: "squad-1", platoonId: "platoon-1" }] as never);
    mockActivities.mockResolvedValue([
      { id: "act-1", platoonId: "platoon-1", cycleId: "cycle-1" },
    ] as never);
    mockSoldiers.mockResolvedValue([
      { id: "sol-1", squadId: "squad-1" },
    ] as never);
    mockReports.mockResolvedValue([
      { activityId: "act-1", soldierId: "sol-1" },
    ] as never);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});
