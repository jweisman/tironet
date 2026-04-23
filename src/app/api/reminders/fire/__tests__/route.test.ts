import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.CRON_SECRET = "test-secret";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    scheduledReminder: { findUnique: vi.fn(), update: vi.fn() },
    request: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/push/send", () => ({
  sendPushToUser: vi.fn(),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { createMockRequest } from "@/__tests__/helpers/api";

const mockFindReminder = vi.mocked(prisma.scheduledReminder.findUnique);
const mockUpdateReminder = vi.mocked(prisma.scheduledReminder.update);
const mockFindRequest = vi.mocked(prisma.request.findUnique);
const mockSendPush = vi.mocked(sendPushToUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockSendPush.mockResolvedValue(undefined);
  mockUpdateReminder.mockResolvedValue({} as never);
});

function createAuthRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/reminders/fire", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer test-secret`,
    },
    body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/reminders/fire", () => {
  it("returns 400 if reminderId is missing", async () => {
    const req = createAuthRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns ok with skipped=true if reminder not found", async () => {
    mockFindReminder.mockResolvedValue(null);
    const req = createAuthRequest({ reminderId: "rem-1" });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
  });

  it("returns ok with skipped=true if already fired", async () => {
    mockFindReminder.mockResolvedValue({ id: "rem-1", fired: true } as never);
    const req = createAuthRequest({ reminderId: "rem-1" });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("marks as fired but skips push if request is denied", async () => {
    mockFindReminder.mockResolvedValue({
      id: "rem-1",
      requestId: "req-1",
      userId: "cmd-1",
      reminderType: "departure",
      eventAt: new Date("2026-05-01T10:00:00Z"),
      fired: false,
    } as never);
    mockFindRequest.mockResolvedValue({
      id: "req-1",
      status: "denied",
      soldier: { familyName: "Cohen", givenName: "Avi" },
    } as never);

    const req = createAuthRequest({ reminderId: "rem-1" });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({ ok: true, skipped: true, reason: "denied_or_deleted" });
    expect(mockUpdateReminder).toHaveBeenCalledWith({
      where: { id: "rem-1" },
      data: { fired: true },
    });
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("fires push notification for valid reminder", async () => {
    mockFindReminder.mockResolvedValue({
      id: "rem-1",
      requestId: "req-1",
      userId: "cmd-1",
      reminderType: "medical",
      eventAt: new Date("2026-05-01T10:00:00Z"),
      fired: false,
    } as never);
    mockFindRequest.mockResolvedValue({
      id: "req-1",
      status: "approved",
      soldier: { familyName: "Cohen", givenName: "Avi" },
    } as never);

    const req = createAuthRequest({ reminderId: "rem-1" });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({ ok: true, fired: true });
    expect(mockUpdateReminder).toHaveBeenCalledWith({
      where: { id: "rem-1" },
      data: { fired: true },
    });
    expect(mockSendPush).toHaveBeenCalledWith("cmd-1", {
      title: expect.stringContaining("תזכורת"),
      body: expect.stringContaining("תור רפואי"),
      url: "/requests/req-1",
    });
  });

  it("sends departure label for departure reminders", async () => {
    mockFindReminder.mockResolvedValue({
      id: "rem-1",
      requestId: "req-1",
      userId: "cmd-1",
      reminderType: "departure",
      eventAt: new Date("2026-05-01T14:30:00Z"),
      fired: false,
    } as never);
    mockFindRequest.mockResolvedValue({
      id: "req-1",
      status: "open",
      soldier: { familyName: "Levi", givenName: "Dan" },
    } as never);

    const req = createAuthRequest({ reminderId: "rem-1" });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({ ok: true, fired: true });
    expect(mockSendPush).toHaveBeenCalledWith("cmd-1", {
      title: "תזכורת",
      body: expect.stringContaining("שעת יציאה"),
      url: "/requests/req-1",
    });
  });
});
