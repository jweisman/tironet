import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TironetConnector } from "../connector";
import { UpdateType } from "@powersync/web";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("TironetConnector", () => {
  let connector: TironetConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connector = new TironetConnector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("fetchCredentials", () => {
    it("fetches a token from the API", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt-token",
            powersync_url: "http://localhost:8080",
          }),
      });

      const creds = await connector.fetchCredentials();
      expect(creds.token).toBe("jwt-token");
      expect(creds.endpoint).toBe("http://localhost:8080");
      expect(mockFetch).toHaveBeenCalledWith("/api/powersync/token");
    });

    it("returns cached token on second call within expiry window", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt-token",
            powersync_url: "http://localhost:8080",
          }),
      });

      await connector.fetchCredentials();
      const creds = await connector.fetchCredentials();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(creds.token).toBe("jwt-token");
    });

    it("re-fetches token after expiry (with 30s buffer)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt-token-1",
            powersync_url: "http://localhost:8080",
          }),
      });

      await connector.fetchCredentials();

      // Advance past 5min - 30s buffer = 4min 30s
      vi.advanceTimersByTime(4 * 60 * 1000 + 31 * 1000);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt-token-2",
            powersync_url: "http://localhost:8080",
          }),
      });

      const creds = await connector.fetchCredentials();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(creds.token).toBe("jwt-token-2");
    });

    it("throws on non-ok response and sets lastFetchError", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Failed to fetch PowerSync token"
      );
    });

    it("throttles retries within 10s of a failed fetch", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(connector.fetchCredentials()).rejects.toThrow();

      // Second call within 10s should be throttled
      vi.advanceTimersByTime(5000);
      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Token fetch throttled (offline)"
      );

      // Only one actual fetch was made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("allows retry after 10s cooldown", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(connector.fetchCredentials()).rejects.toThrow();

      vi.advanceTimersByTime(10_001);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "recovered",
            powersync_url: "http://localhost:8080",
          }),
      });

      const creds = await connector.fetchCredentials();
      expect(creds.token).toBe("recovered");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("uploadData", () => {
    function mockDatabase(crud: Array<{ table: string; op: UpdateType; id: string; opData?: Record<string, unknown> }>) {
      return {
        getNextCrudTransaction: vi.fn().mockResolvedValue({
          crud,
          complete: vi.fn(),
        }),
      } as unknown;
    }

    it("does nothing when no transaction", async () => {
      const db = {
        getNextCrudTransaction: vi.fn().mockResolvedValue(null),
      } as unknown;
      await connector.uploadData(db as never);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("uploads activity_report PUT with camelCase transform and client ID", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activity_reports",
          op: UpdateType.PUT,
          id: "report-uuid",
          opData: {
            activity_id: "act-1",
            soldier_id: "sol-1",
            result: "passed",
            grade: 85,
            note: "good",
          },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activity-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "report-uuid",
          activityId: "act-1",
          soldierId: "sol-1",
          result: "passed",
          grade: 85,
          note: "good",
        }),
      });

      // transaction.complete() should be called
      const tx = await (db as { getNextCrudTransaction: () => Promise<{ complete: () => void }> }).getNextCrudTransaction();
      expect(tx.complete).toHaveBeenCalled();
    });

    it("uploads activity_report PATCH to correct endpoint", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activity_reports",
          op: UpdateType.PATCH,
          id: "report-1",
          opData: { result: "failed" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activity-reports/report-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: "failed" }),
      });
    });

    it("uploads activity_report DELETE", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activity_reports",
          op: UpdateType.DELETE,
          id: "report-1",
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activity-reports/report-1", {
        method: "DELETE",
      });
    });

    it("uploads activities PUT with client ID", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activities",
          op: UpdateType.PUT,
          id: "act-uuid",
          opData: { name: "Test Activity", cycleId: "c1" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "act-uuid", name: "Test Activity", cycleId: "c1" }),
      });
    });

    it("uploads activities PATCH", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activities",
          op: UpdateType.PATCH,
          id: "act-1",
          opData: { name: "Updated Activity" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activities/act-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Activity" }),
      });
    });

    it("uploads activities DELETE", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activities",
          op: UpdateType.DELETE,
          id: "act-1",
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activities/act-1", {
        method: "DELETE",
      });
    });

    it("uploads soldiers PUT with client ID", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "soldiers",
          op: UpdateType.PUT,
          id: "sol-uuid",
          opData: { given_name: "New", family_name: "Soldier", cycle_id: "c1" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/soldiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "sol-uuid", given_name: "New", family_name: "Soldier", cycle_id: "c1" }),
      });
    });

    it("uploads soldiers DELETE", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "soldiers",
          op: UpdateType.DELETE,
          id: "sol-1",
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/soldiers/sol-1", {
        method: "DELETE",
      });
    });

    it("uploads soldiers PATCH", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "soldiers",
          op: UpdateType.PATCH,
          id: "sol-1",
          opData: { firstName: "Updated" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/soldiers/sol-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "Updated" }),
      });
    });

    it("does not call transaction.complete() on network error", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      const db = mockDatabase([
        {
          table: "activity_reports",
          op: UpdateType.PUT,
          id: "r1",
          opData: { activity_id: "a1", soldier_id: "s1", result: "passed" },
        },
      ]);

      // Should not throw (error is caught)
      await connector.uploadData(db as never);

      const tx = await (db as { getNextCrudTransaction: () => Promise<{ complete: () => void }> }).getNextCrudTransaction();
      expect(tx.complete).not.toHaveBeenCalled();
    });

    it("does not call transaction.complete() on non-fetch errors", async () => {
      mockFetch.mockRejectedValue(new Error("Server error"));

      const db = mockDatabase([
        {
          table: "activities",
          op: UpdateType.DELETE,
          id: "a1",
        },
      ]);

      await connector.uploadData(db as never);

      const tx = await (db as { getNextCrudTransaction: () => Promise<{ complete: () => void }> }).getNextCrudTransaction();
      expect(tx.complete).not.toHaveBeenCalled();
    });
  });
});
