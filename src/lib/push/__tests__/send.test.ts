import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ensure VAPID env vars are set so ensureVapidConfigured() doesn't early-return.
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";

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
    user: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/twilio", () => ({
  sendSms: vi.fn(),
}));

import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { sendSms } from "@/lib/twilio";
import { sendPushToUser, sendPushToUsers, formatSmsBody } from "../send";

const mockSendNotification = vi.mocked(webpush.sendNotification);
const mockFindSubs = vi.mocked(prisma.pushSubscription.findMany);
const mockDeleteSub = vi.mocked(prisma.pushSubscription.delete);
const mockFindUsers = vi.mocked(prisma.user.findMany);
const mockSendSms = vi.mocked(sendSms);

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

describe("sendPushToUser — missing VAPID keys", () => {
  it("no-ops when VAPID keys are not configured", async () => {
    const origPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const origPrivate = process.env.VAPID_PRIVATE_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    // Reset the lazy-init flag by re-importing a fresh module
    vi.resetModules();
    const { sendPushToUser: freshSend } = await import("../send");
    await freshSend("user-1", payload);
    expect(mockFindSubs).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = origPublic;
    process.env.VAPID_PRIVATE_KEY = origPrivate;
  });
});

describe("sendPushToUsers — channel routing", () => {
  function user(
    id: string,
    overrides: { phone?: string | null; channel?: "off" | "in_app" | "sms"; enabled?: boolean } = {},
  ) {
    const { phone = null, channel, enabled = true } = overrides;
    return {
      id,
      phone,
      notificationPreference: channel
        ? {
            channel,
            dailyTasksEnabled: enabled,
            requestAssignmentEnabled: enabled,
            activeRequestsEnabled: enabled,
            newAppointmentEnabled: enabled,
            severeIncidentEnabled: enabled,
          }
        : null,
    };
  }

  it("does nothing with empty user list", async () => {
    await sendPushToUsers([], payload, "dailyTasksEnabled");
    expect(mockFindUsers).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("treats missing preference as channel=off (opt-in model)", async () => {
    mockFindUsers.mockResolvedValue([user("user-1")] as never);

    await sendPushToUsers(["user-1"], payload, "dailyTasksEnabled");
    // No push lookup, no SMS — user with no preference row gets nothing.
    expect(mockFindSubs).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("skips users with channel=off", async () => {
    mockFindUsers.mockResolvedValue([
      user("user-1", { channel: "off" }),
      user("user-2", { channel: "in_app" }),
    ] as never);
    mockFindSubs.mockResolvedValue([]);

    await sendPushToUsers(["user-1", "user-2"], payload, "dailyTasksEnabled");
    expect(mockFindSubs).toHaveBeenCalledTimes(1);
    expect(mockFindSubs).toHaveBeenCalledWith({ where: { userId: "user-2" } });
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("skips users who opted out of the specific notification", async () => {
    mockFindUsers.mockResolvedValue([
      user("user-1", { channel: "in_app", enabled: false }),
      user("user-2", { channel: "in_app", enabled: true }),
    ] as never);
    mockFindSubs.mockResolvedValue([]);

    await sendPushToUsers(["user-1", "user-2"], payload, "dailyTasksEnabled");
    expect(mockFindSubs).toHaveBeenCalledTimes(1);
    expect(mockFindSubs).toHaveBeenCalledWith({ where: { userId: "user-2" } });
  });

  it("sends SMS to users with channel=sms and a phone number", async () => {
    mockFindUsers.mockResolvedValue([
      user("user-1", { channel: "sms", phone: "+972501234567" }),
    ] as never);
    mockSendSms.mockResolvedValue(undefined);

    await sendPushToUsers(["user-1"], payload, "dailyTasksEnabled");
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms).toHaveBeenCalledWith("+972501234567", expect.stringContaining("Hello"));
    expect(mockFindSubs).not.toHaveBeenCalled();
  });

  it("skips SMS users without a phone number", async () => {
    mockFindUsers.mockResolvedValue([
      user("user-1", { channel: "sms", phone: null }),
    ] as never);

    await sendPushToUsers(["user-1"], payload, "dailyTasksEnabled");
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockFindSubs).not.toHaveBeenCalled();
  });

  it("respects the per-notification toggle on SMS users too", async () => {
    mockFindUsers.mockResolvedValue([
      user("user-1", { channel: "sms", phone: "+972501234567", enabled: false }),
    ] as never);

    await sendPushToUsers(["user-1"], payload, "dailyTasksEnabled");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("routes a mixed batch correctly (push + sms + skipped)", async () => {
    mockFindUsers.mockResolvedValue([
      user("push-user", { channel: "in_app" }),
      user("sms-user", { channel: "sms", phone: "+972500000001" }),
      user("off-user", { channel: "off" }),
      user("default-user"), // no preference row → opt-in default = off → skipped
    ] as never);
    mockFindSubs.mockResolvedValue([]);
    mockSendSms.mockResolvedValue(undefined);

    await sendPushToUsers(
      ["push-user", "sms-user", "off-user", "default-user"],
      payload,
      "requestAssignmentEnabled",
    );

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms).toHaveBeenCalledWith("+972500000001", expect.any(String));
    expect(mockFindSubs).toHaveBeenCalledTimes(1); // push-user only
    expect(mockFindSubs).toHaveBeenCalledWith({ where: { userId: "push-user" } });
  });

  it("swallows SMS send failures so one user doesn't block the batch", async () => {
    mockFindUsers.mockResolvedValue([
      user("user-1", { channel: "sms", phone: "+972500000001" }),
      user("user-2", { channel: "sms", phone: "+972500000002" }),
    ] as never);
    mockSendSms.mockRejectedValueOnce(new Error("twilio down"));
    mockSendSms.mockResolvedValueOnce(undefined);

    await expect(
      sendPushToUsers(["user-1", "user-2"], payload, "dailyTasksEnabled"),
    ).resolves.toBeUndefined();
    expect(mockSendSms).toHaveBeenCalledTimes(2);
  });
});

describe("formatSmsBody", () => {
  const ORIG_APP_URL = process.env.APP_URL;
  const ORIG_PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env.APP_URL = ORIG_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = ORIG_PUBLIC_URL;
  });

  it("includes body and absolute URL only — title is dropped", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://tironet.org.il";
    const out = formatSmsBody({ title: "בקשה חדשה", body: "Cohen Avi", url: "/requests/abc" });
    expect(out).toBe("Cohen Avi\nhttps://tironet.org.il/requests/abc");
    expect(out).not.toContain("בקשה חדשה");
  });

  it("prefers NEXT_PUBLIC_APP_URL over APP_URL (APP_URL is for Docker-internal use)", () => {
    process.env.APP_URL = "http://host.docker.internal:3001";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
    const out = formatSmsBody({ title: "T", body: "B", url: "/x" });
    expect(out).toBe("B\nhttp://localhost:3001/x");
  });

  it("falls back to APP_URL when NEXT_PUBLIC_APP_URL is missing", () => {
    process.env.APP_URL = "https://tironet.org.il";
    const out = formatSmsBody({ title: "T", body: "B", url: "/x" });
    expect(out).toBe("B\nhttps://tironet.org.il/x");
  });

  it("strips trailing slash from base url", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://tironet.org.il/";
    const out = formatSmsBody({ title: "T", body: "B", url: "/x" });
    expect(out).toContain("https://tironet.org.il/x");
    expect(out).not.toContain("//x");
  });

  it("leaves absolute URLs untouched", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://tironet.org.il";
    const out = formatSmsBody({ title: "T", body: "B", url: "https://other.example/path" });
    expect(out).toContain("https://other.example/path");
  });

  it("falls back to relative URL when no base is configured", () => {
    const out = formatSmsBody({ title: "T", body: "B", url: "/x" });
    expect(out).toBe("B\n/x");
  });

  it("truncates an oversized body but preserves the URL intact", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://tironet.org.il";
    const longBody = "א".repeat(1000);
    const out = formatSmsBody({ title: "T", body: longBody, url: "/requests/abc" });

    expect(out.length).toBeLessThanOrEqual(320);
    expect(out).toContain("…");
    expect(out).toMatch(/\nhttps:\/\/tironet\.org\.il\/requests\/abc$/);
    expect(out.endsWith("https://tironet.org.il/requests/abc")).toBe(true);
  });

  it("does not truncate when body fits under the cap", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://tironet.org.il";
    const out = formatSmsBody({ title: "T", body: "short body", url: "/x" });
    expect(out).not.toContain("…");
    expect(out).toBe("short body\nhttps://tironet.org.il/x");
  });
});
