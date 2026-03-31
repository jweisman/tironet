import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    pushSubscription: { findMany: vi.fn(), delete: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
  },
}));

import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser, sendPushToUsers } from "../send";

const mockSendNotification = vi.mocked(webpush.sendNotification);
const mockFindSubs = vi.mocked(prisma.pushSubscription.findMany);
const mockDeleteSub = vi.mocked(prisma.pushSubscription.delete);
const mockFindPrefs = vi.mocked(prisma.notificationPreference.findMany);

const payload = { title: "Test", body: "Hello", url: "/test" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendPushToUser", () => {
  it("does nothing when user has no subscriptions", async () => {
    mockFindSubs.mockResolvedValue([]);
    await sendPushToUser("user-1", payload);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sends to all subscriptions", async () => {
    mockFindSubs.mockResolvedValue([
      { id: "sub-1", userId: "user-1", endpoint: "https://a.com", p256dh: "key1", auth: "auth1" },
      { id: "sub-2", userId: "user-1", endpoint: "https://b.com", p256dh: "key2", auth: "auth2" },
    ] as never);
    mockSendNotification.mockResolvedValue({} as never);

    await sendPushToUser("user-1", payload);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("deletes subscription on 410 Gone", async () => {
    mockFindSubs.mockResolvedValue([
      { id: "sub-1", userId: "user-1", endpoint: "https://a.com", p256dh: "key1", auth: "auth1" },
    ] as never);
    mockSendNotification.mockRejectedValue({ statusCode: 410 });
    mockDeleteSub.mockResolvedValue({} as never);

    await sendPushToUser("user-1", payload);
    expect(mockDeleteSub).toHaveBeenCalledWith({ where: { id: "sub-1" } });
  });

  it("deletes subscription on 404 Not Found", async () => {
    mockFindSubs.mockResolvedValue([
      { id: "sub-1", userId: "user-1", endpoint: "https://a.com", p256dh: "key1", auth: "auth1" },
    ] as never);
    mockSendNotification.mockRejectedValue({ statusCode: 404 });
    mockDeleteSub.mockResolvedValue({} as never);

    await sendPushToUser("user-1", payload);
    expect(mockDeleteSub).toHaveBeenCalledWith({ where: { id: "sub-1" } });
  });

  it("deletes subscription on 403 Forbidden (Apple expired)", async () => {
    mockFindSubs.mockResolvedValue([
      { id: "sub-1", userId: "user-1", endpoint: "https://web.push.apple.com/test", p256dh: "key1", auth: "auth1" },
    ] as never);
    mockSendNotification.mockRejectedValue({ statusCode: 403 });
    mockDeleteSub.mockResolvedValue({} as never);

    await sendPushToUser("user-1", payload);
    expect(mockDeleteSub).toHaveBeenCalledWith({ where: { id: "sub-1" } });
  });

  it("does not delete subscription on other errors", async () => {
    mockFindSubs.mockResolvedValue([
      { id: "sub-1", userId: "user-1", endpoint: "https://a.com", p256dh: "key1", auth: "auth1" },
    ] as never);
    mockSendNotification.mockRejectedValue({ statusCode: 500 });

    await sendPushToUser("user-1", payload);
    expect(mockDeleteSub).not.toHaveBeenCalled();
  });
});

describe("sendPushToUsers", () => {
  it("does nothing with empty user list", async () => {
    await sendPushToUsers([], payload, "dailyTasksEnabled");
    expect(mockFindPrefs).not.toHaveBeenCalled();
    expect(mockFindSubs).not.toHaveBeenCalled();
  });

  it("respects opt-out preferences", async () => {
    mockFindPrefs.mockResolvedValue([
      { userId: "user-1", dailyTasksEnabled: false },
    ] as never);
    mockFindSubs.mockResolvedValue([]);

    await sendPushToUsers(["user-1", "user-2"], payload, "dailyTasksEnabled");

    // user-1 opted out, so only user-2 should get a push attempt
    const findSubsCalls = mockFindSubs.mock.calls;
    expect(findSubsCalls.length).toBe(1);
    expect(findSubsCalls[0][0]).toEqual({ where: { userId: "user-2" } });
  });

  it("treats missing preference as enabled (opt-out model)", async () => {
    mockFindPrefs.mockResolvedValue([]);
    mockFindSubs.mockResolvedValue([]);

    await sendPushToUsers(["user-1"], payload, "dailyTasksEnabled");
    expect(mockFindSubs).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });
});
