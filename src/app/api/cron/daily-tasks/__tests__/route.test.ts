import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userCycleAssignment: { findMany: vi.fn() },
    squad: { findMany: vi.fn() },
    activity: { findMany: vi.fn() },
    soldier: { findMany: vi.fn() },
    activityReport: { findMany: vi.fn() },
    request: { findMany: vi.fn() },
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
const mockRequests = vi.mocked(prisma.request.findMany);
const mockSendPush = vi.mocked(sendPushToUsers);

function makeRequest(secret = "test-secret", mode?: string): NextRequest {
  const url = mode
    ? `http://localhost:3000/api/cron/daily-tasks?mode=${mode}`
    : "http://localhost:3000/api/cron/daily-tasks";
  return new NextRequest(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-secret");
  // Default: no assignments, no requests
  mockAssignments.mockResolvedValue([]);
  mockRequests.mockResolvedValue([]);
});

describe("GET /api/cron/daily-tasks", () => {
  it("returns 401 with wrong secret", async () => {
    const res = await GET(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns mode=evening by default", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.mode).toBe("evening");
  });

  it("returns mode=morning when specified", async () => {
    const res = await GET(makeRequest("test-secret", "morning"));
    const body = await res.json();
    expect(body.mode).toBe("morning");
  });

  it("evening: returns activityGaps.sent=0 when no squad commanders", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.activityGaps.sent).toBe(0);
  });

  it("evening: sends activity gap notification when there are missing reports", async () => {
    // First call: squad commanders for activity gaps
    // Second call: squad + platoon commanders for active requests
    mockAssignments
      .mockResolvedValueOnce([
        { userId: "user-1", unitId: "squad-1", cycleId: "cycle-1" },
      ] as never)
      .mockResolvedValueOnce([] as never);
    mockSquads.mockResolvedValue([{ id: "squad-1", platoonId: "platoon-1" }] as never);
    mockActivities.mockResolvedValue([
      { id: "act-1", platoonId: "platoon-1", cycleId: "cycle-1" },
    ] as never);
    mockSoldiers.mockResolvedValue([
      { id: "sol-1", squadId: "squad-1" },
      { id: "sol-2", squadId: "squad-1" },
    ] as never);
    mockReports.mockResolvedValue([
      { activityId: "act-1", soldierId: "sol-1" },
    ] as never);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.activityGaps.total).toBe(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      ["user-1"],
      expect.objectContaining({
        title: "דיווחי פעילויות חסרים",
        url: "/activities?filter=gaps",
      }),
      "dailyTasksEnabled",
    );
  });

  it("evening: does not send activity gaps when all reports exist", async () => {
    mockAssignments
      .mockResolvedValueOnce([
        { userId: "user-1", unitId: "squad-1", cycleId: "cycle-1" },
      ] as never)
      .mockResolvedValueOnce([] as never);
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
    expect(body.activityGaps.total).toBe(0);
  });

  it("morning: skips activity gaps, sends active request notifications with detail rows", async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    // Morning: only active requests, no activity gaps
    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", unitType: "squad", role: "squad_commander", cycleId: "cycle-1" },
    ] as never);
    mockRequests.mockResolvedValue([
      {
        id: "req-1",
        type: "medical",
        departureAt: null,
        returnAt: null,
        medicalAppointments: JSON.stringify([
          { id: "a1", date: `${todayStr}T11:30:00Z`, place: "A", type: "X" },
        ]),
        sickDays: null,
        soldier: { squadId: "squad-1", familyName: "כהן", givenName: "אבי" },
      },
    ] as never);

    const res = await GET(makeRequest("test-secret", "morning"));
    const body = await res.json();
    expect(body.activityGaps).toBeUndefined();
    expect(body.activeRequests.total).toBe(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      ["user-1"],
      expect.objectContaining({
        title: "בקשות פעילות",
        body: "יש בקשה פעילה אחת להיום\nכהן אבי תור רפואי בשעה 14:30",
        url: "/requests?filter=active",
      }),
      "activeRequestsEnabled",
    );
  });

  it("evening: sends active request notifications for tomorrow", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    // First call: squad commanders for activity gaps (none)
    // Second call: commanders for active requests
    mockAssignments
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { userId: "user-1", unitId: "platoon-1", unitType: "platoon", role: "platoon_commander", cycleId: "cycle-1" },
      ] as never);
    mockSquads.mockResolvedValue([{ id: "squad-1", platoonId: "platoon-1" }] as never);
    mockRequests.mockResolvedValue([
      {
        id: "req-1",
        type: "leave",
        departureAt: new Date(tomorrowStr + "T08:00:00Z"),
        returnAt: new Date(tomorrowStr + "T13:00:00Z"),
        medicalAppointments: null,
        sickDays: null,
        soldier: { squadId: "squad-1", familyName: "לוי", givenName: "דן" },
      },
    ] as never);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.activeRequests.total).toBe(1);
    // Both departure and return fall on tomorrow → departure wins (single-day)
    expect(mockSendPush).toHaveBeenCalledWith(
      ["user-1"],
      expect.objectContaining({
        title: "בקשות פעילות",
        body: "יש בקשה פעילה אחת למחר\nלוי דן יציאה עד 11:00",
      }),
      "activeRequestsEnabled",
    );
  });

  it("morning: orders detail rows by time, plural opener, sick day last", async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", unitType: "squad", role: "squad_commander", cycleId: "cycle-1" },
    ] as never);
    mockRequests.mockResolvedValue([
      {
        // late medical
        id: "req-1",
        type: "medical",
        departureAt: null,
        returnAt: null,
        medicalAppointments: JSON.stringify([
          { id: "a1", date: `${todayStr}T13:30:00Z`, place: "X", type: "Y" },
        ]),
        sickDays: null,
        soldier: { squadId: "squad-1", familyName: "דגן", givenName: "יוסי" },
      },
      {
        // early medical
        id: "req-2",
        type: "medical",
        departureAt: null,
        returnAt: null,
        medicalAppointments: JSON.stringify([
          { id: "a2", date: `${todayStr}T07:30:00Z`, place: "X", type: "Y" },
        ]),
        sickDays: null,
        soldier: { squadId: "squad-1", familyName: "לוי", givenName: "דן" },
      },
      {
        // sick day (all-day → last)
        id: "req-3",
        type: "medical",
        departureAt: null,
        returnAt: null,
        medicalAppointments: null,
        sickDays: JSON.stringify([{ id: "d1", date: todayStr }]),
        soldier: { squadId: "squad-1", familyName: "כהן", givenName: "אבי" },
      },
    ] as never);

    const res = await GET(makeRequest("test-secret", "morning"));
    const body = await res.json();
    expect(body.activeRequests.total).toBe(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      ["user-1"],
      expect.objectContaining({
        body: [
          "יש 3 בקשות פעילות להיום",
          "לוי דן תור רפואי בשעה 10:30",
          "דגן יוסי תור רפואי בשעה 16:30",
          "כהן אבי ביום מחלה",
        ].join("\n"),
      }),
      "activeRequestsEnabled",
    );
  });

  it("morning: caps detail rows at 3 and appends remaining count to the last line", async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", unitType: "squad", role: "squad_commander", cycleId: "cycle-1" },
    ] as never);
    const requests = Array.from({ length: 6 }, (_, i) => ({
      id: `req-${i}`,
      type: "medical",
      departureAt: null,
      returnAt: null,
      medicalAppointments: JSON.stringify([
        { id: `a${i}`, date: `${todayStr}T${String(6 + i).padStart(2, "0")}:00:00Z`, place: "X", type: "Y" },
      ]),
      sickDays: null,
      soldier: { squadId: "squad-1", familyName: "כהן", givenName: `סולדייר${i}` },
    }));
    mockRequests.mockResolvedValue(requests as never);

    const res = await GET(makeRequest("test-secret", "morning"));
    expect(res.status).toBe(200);
    const call = mockSendPush.mock.calls[0];
    expect(call?.[1].body).toMatch(/^יש 6 בקשות פעילות להיום\n/);
    // opener + 3 detail rows; "more" appended to the last detail line, not a new line
    const lines = call?.[1].body.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines?.[lines.length - 1]).toMatch(/ — ועוד 3$/);
  });

  it("morning: uses 'ועוד אחת' when only one extra request remains", async () => {
    const todayStr = new Date().toISOString().split("T")[0];

    mockAssignments.mockResolvedValue([
      { userId: "user-1", unitId: "squad-1", unitType: "squad", role: "squad_commander", cycleId: "cycle-1" },
    ] as never);
    const requests = Array.from({ length: 4 }, (_, i) => ({
      id: `req-${i}`,
      type: "medical",
      departureAt: null,
      returnAt: null,
      medicalAppointments: JSON.stringify([
        { id: `a${i}`, date: `${todayStr}T${String(6 + i).padStart(2, "0")}:00:00Z`, place: "X", type: "Y" },
      ]),
      sickDays: null,
      soldier: { squadId: "squad-1", familyName: "כהן", givenName: `סולדייר${i}` },
    }));
    mockRequests.mockResolvedValue(requests as never);

    const res = await GET(makeRequest("test-secret", "morning"));
    expect(res.status).toBe(200);
    const call = mockSendPush.mock.calls[0];
    const lines = call?.[1].body.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines?.[lines.length - 1]).toMatch(/ — ועוד אחת$/);
  });
});
