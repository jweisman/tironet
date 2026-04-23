import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    request: { findUnique: vi.fn(), findMany: vi.fn() },
    soldier: { findUnique: vi.fn() },
    squad: { findMany: vi.fn() },
    userCycleAssignment: { findMany: vi.fn() },
    notificationPreference: { findUnique: vi.fn(), findMany: vi.fn() },
    scheduledReminder: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../qstash", () => ({
  publishReminder: vi.fn(),
  cancelReminder: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { publishReminder, cancelReminder } from "../qstash";
import {
  scheduleRemindersForRequest,
  cancelAllRemindersForRequest,
  rescheduleRemindersForUser,
} from "../schedule";

const mockPublish = vi.mocked(publishReminder);
const mockCancel = vi.mocked(cancelReminder);
const mockRequest = vi.mocked(prisma.request.findUnique);
const mockRequestFindMany = vi.mocked(prisma.request.findMany);
const mockSoldier = vi.mocked(prisma.soldier.findUnique);
const mockSquadFindMany = vi.mocked(prisma.squad.findMany);
const mockAssignments = vi.mocked(prisma.userCycleAssignment.findMany);
const mockPrefFindMany = vi.mocked(prisma.notificationPreference.findMany);
const mockPrefFindUnique = vi.mocked(prisma.notificationPreference.findUnique);
const mockReminderFindMany = vi.mocked(prisma.scheduledReminder.findMany);
const mockReminderCreate = vi.mocked(prisma.scheduledReminder.create);
const mockReminderUpdate = vi.mocked(prisma.scheduledReminder.update);
const mockReminderDelete = vi.mocked(prisma.scheduledReminder.delete);
const mockReminderDeleteMany = vi.mocked(prisma.scheduledReminder.deleteMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockPublish.mockResolvedValue("msg-1");
  mockCancel.mockResolvedValue(undefined);
  mockReminderDeleteMany.mockResolvedValue({ count: 0 } as never);
});

// Helpers
const futureDate = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);

function setupSoldierAndCommanders(opts?: { leadMinutes?: number }) {
  const lead = opts?.leadMinutes ?? 30;
  mockSoldier.mockResolvedValue({
    squadId: "squad-1",
    squad: { platoonId: "platoon-1" },
  } as never);
  mockAssignments.mockResolvedValue([
    { userId: "cmd-1" },
  ] as never);
  mockPrefFindMany.mockResolvedValue([
    { userId: "cmd-1", reminderLeadMinutes: lead },
  ] as never);
}

describe("scheduleRemindersForRequest", () => {
  it("does nothing if request not found", async () => {
    mockRequest.mockResolvedValue(null);
    await scheduleRemindersForRequest("req-1");
    expect(mockSoldier).not.toHaveBeenCalled();
  });

  it("cancels all reminders if request is denied", async () => {
    mockRequest.mockResolvedValue({
      id: "req-1",
      type: "leave",
      status: "denied",
      departureAt: futureDate(2),
      medicalAppointments: null,
      soldierId: "soldier-1",
    } as never);
    mockReminderFindMany.mockResolvedValue([
      { id: "rem-1", qstashMessageId: "qmsg-1", fired: false },
    ] as never);

    await scheduleRemindersForRequest("req-1");

    expect(mockCancel).toHaveBeenCalledWith("qmsg-1");
    expect(mockReminderDeleteMany).toHaveBeenCalled();
  });

  it("schedules a departure reminder for a leave request", async () => {
    const departure = futureDate(3);
    mockRequest.mockResolvedValue({
      id: "req-1",
      type: "leave",
      status: "open",
      departureAt: departure,
      medicalAppointments: null,
      soldierId: "soldier-1",
    } as never);
    setupSoldierAndCommanders();
    mockReminderFindMany.mockResolvedValue([]);
    mockReminderCreate.mockResolvedValue({ id: "rem-new" } as never);
    mockReminderUpdate.mockResolvedValue({} as never);

    await scheduleRemindersForRequest("req-1");

    expect(mockReminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: "req-1",
          userId: "cmd-1",
          appointmentId: null,
          reminderType: "departure",
        }),
      }),
    );
    expect(mockPublish).toHaveBeenCalled();
  });

  it("schedules reminders for medical appointments with time only", async () => {
    const futureTime = futureDate(5).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const futureDay = futureDate(48).toISOString().slice(0, 10); // YYYY-MM-DD (no time)
    mockRequest.mockResolvedValue({
      id: "req-2",
      type: "medical",
      status: "approved",
      departureAt: null,
      medicalAppointments: JSON.stringify([
        { id: "appt-1", date: futureTime, place: "Hospital", type: "checkup" },
        { id: "appt-2", date: futureDay, place: "Clinic", type: "followup" },
      ]),
      soldierId: "soldier-1",
    } as never);
    setupSoldierAndCommanders();
    mockReminderFindMany.mockResolvedValue([]);
    mockReminderCreate.mockResolvedValue({ id: "rem-new" } as never);
    mockReminderUpdate.mockResolvedValue({} as never);

    await scheduleRemindersForRequest("req-2");

    // Only appt-1 (has time) should get a reminder, not appt-2 (date-only)
    expect(mockReminderCreate).toHaveBeenCalledTimes(1);
    expect(mockReminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appointmentId: "appt-1",
          reminderType: "medical",
        }),
      }),
    );
  });

  it("skips commanders with no reminderLeadMinutes", async () => {
    mockRequest.mockResolvedValue({
      id: "req-1",
      type: "leave",
      status: "open",
      departureAt: futureDate(3),
      medicalAppointments: null,
      soldierId: "soldier-1",
    } as never);
    mockSoldier.mockResolvedValue({
      squadId: "squad-1",
      squad: { platoonId: "platoon-1" },
    } as never);
    mockAssignments.mockResolvedValue([
      { userId: "cmd-1" },
    ] as never);
    // No preference row → lead is null
    mockPrefFindMany.mockResolvedValue([]);
    mockReminderFindMany.mockResolvedValue([]);

    await scheduleRemindersForRequest("req-1");

    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("skips past events", async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    mockRequest.mockResolvedValue({
      id: "req-1",
      type: "leave",
      status: "open",
      departureAt: pastDate,
      medicalAppointments: null,
      soldierId: "soldier-1",
    } as never);
    setupSoldierAndCommanders();
    mockReminderFindMany.mockResolvedValue([]);

    await scheduleRemindersForRequest("req-1");

    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("deletes reminders for removed events", async () => {
    mockRequest.mockResolvedValue({
      id: "req-1",
      type: "leave",
      status: "open",
      departureAt: null, // departure cleared
      medicalAppointments: null,
      soldierId: "soldier-1",
    } as never);
    setupSoldierAndCommanders();
    mockReminderFindMany.mockResolvedValue([
      {
        id: "rem-old",
        requestId: "req-1",
        userId: "cmd-1",
        appointmentId: null,
        reminderType: "departure",
        qstashMessageId: "qmsg-old",
        fired: false,
        scheduledFor: futureDate(2),
        eventAt: futureDate(3),
      },
    ] as never);

    await scheduleRemindersForRequest("req-1");

    expect(mockCancel).toHaveBeenCalledWith("qmsg-old");
    expect(mockReminderDelete).toHaveBeenCalledWith({ where: { id: "rem-old" } });
  });

  it("reschedules when scheduledFor changes", async () => {
    const newDeparture = futureDate(5);
    mockRequest.mockResolvedValue({
      id: "req-1",
      type: "leave",
      status: "open",
      departureAt: newDeparture,
      medicalAppointments: null,
      soldierId: "soldier-1",
    } as never);
    setupSoldierAndCommanders({ leadMinutes: 60 });
    const oldScheduledFor = futureDate(2);
    mockReminderFindMany.mockResolvedValue([
      {
        id: "rem-1",
        requestId: "req-1",
        userId: "cmd-1",
        appointmentId: null,
        reminderType: "departure",
        qstashMessageId: "qmsg-1",
        fired: false,
        scheduledFor: oldScheduledFor,
        eventAt: futureDate(3),
      },
    ] as never);
    mockReminderUpdate.mockResolvedValue({} as never);

    await scheduleRemindersForRequest("req-1");

    // Should cancel old and reschedule
    expect(mockCancel).toHaveBeenCalledWith("qmsg-1");
    expect(mockPublish).toHaveBeenCalled();
    expect(mockReminderUpdate).toHaveBeenCalled();
  });
});

describe("cancelAllRemindersForRequest", () => {
  it("cancels all unfired reminders and returns message IDs", async () => {
    mockReminderFindMany.mockResolvedValue([
      { id: "rem-1", qstashMessageId: "qmsg-1" },
      { id: "rem-2", qstashMessageId: "qmsg-2" },
    ] as never);

    const ids = await cancelAllRemindersForRequest("req-1");

    expect(ids).toEqual(["qmsg-1", "qmsg-2"]);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockReminderDeleteMany).toHaveBeenCalledWith({
      where: { requestId: "req-1", fired: false },
    });
  });
});

describe("rescheduleRemindersForUser", () => {
  it("cancels existing and creates new reminders based on updated preference", async () => {
    // Existing reminders to cancel
    mockReminderFindMany.mockResolvedValue([
      { id: "rem-old", qstashMessageId: "qmsg-old" },
    ] as never);
    mockReminderDeleteMany.mockResolvedValue({ count: 1 } as never);

    // New preference: 60 minutes
    mockPrefFindUnique.mockResolvedValue({ reminderLeadMinutes: 60 } as never);

    // User's assignments
    mockAssignments.mockResolvedValue([
      { unitId: "squad-1", unitType: "squad", role: "squad_commander" },
    ] as never);

    // Requests in scope
    const departure = futureDate(3);
    mockRequestFindMany.mockResolvedValue([
      { id: "req-1", type: "leave", departureAt: departure, medicalAppointments: null },
    ] as never);

    mockReminderCreate.mockResolvedValue({ id: "rem-new" } as never);
    mockReminderUpdate.mockResolvedValue({} as never);

    await rescheduleRemindersForUser("cmd-1");

    expect(mockCancel).toHaveBeenCalledWith("qmsg-old");
    expect(mockReminderCreate).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalled();
  });

  it("only cancels if new preference is null", async () => {
    mockReminderFindMany.mockResolvedValue([
      { id: "rem-old", qstashMessageId: "qmsg-old" },
    ] as never);
    mockReminderDeleteMany.mockResolvedValue({ count: 1 } as never);
    mockPrefFindUnique.mockResolvedValue({ reminderLeadMinutes: null } as never);

    await rescheduleRemindersForUser("cmd-1");

    expect(mockCancel).toHaveBeenCalledWith("qmsg-old");
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });
});
