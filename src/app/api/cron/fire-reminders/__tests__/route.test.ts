import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.CRON_SECRET = "test-secret";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    scheduledReminder: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    request: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/push/send", () => ({
  sendPushToUser: vi.fn(),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/send";

const mockFindMany = vi.mocked(prisma.scheduledReminder.findMany);
const mockUpdate = vi.mocked(prisma.scheduledReminder.update);
const mockFindRequest = vi.mocked(prisma.request.findUnique);
const mockSendPush = vi.mocked(sendPushToUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockSendPush.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue({} as never);
});

function createCronRequest() {
  return new Request("http://localhost/api/cron/fire-reminders", {
    headers: { Authorization: "Bearer test-secret" },
  }) as never;
}

describe("GET /api/cron/fire-reminders", () => {
  it("returns 401 without correct secret", async () => {
    const req = new Request("http://localhost/api/cron/fire-reminders", {
      headers: { Authorization: "Bearer wrong" },
    }) as never;
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 0 fired when no pending reminders", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await GET(createCronRequest());
    const body = await res.json();
    expect(body).toEqual({ fired: 0, total: 0, cleaned: 0 });
  });

  it("fires pending reminders and skips denied requests", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "rem-1",
        requestId: "req-1",
        userId: "cmd-1",
        reminderType: "medical",
        eventAt: new Date("2026-05-01T10:00:00Z"),
      },
      {
        id: "rem-2",
        requestId: "req-2",
        userId: "cmd-2",
        reminderType: "departure",
        eventAt: new Date("2026-05-01T14:00:00Z"),
      },
    ] as never);

    // First request is approved, second is denied
    mockFindRequest
      .mockResolvedValueOnce({
        id: "req-1",
        status: "approved",
        soldier: { familyName: "Cohen", givenName: "Avi" },
      } as never)
      .mockResolvedValueOnce({
        id: "req-2",
        status: "denied",
        soldier: { familyName: "Levi", givenName: "Dan" },
      } as never);

    const res = await GET(createCronRequest());
    const body = await res.json();

    expect(body).toEqual({ fired: 1, total: 2, cleaned: 0 });
    expect(mockUpdate).toHaveBeenCalledTimes(2); // Both marked as fired
    expect(mockSendPush).toHaveBeenCalledTimes(1); // Only first gets push
  });
});
