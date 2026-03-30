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

    it("throws auth error on 401 response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Authentication expired (401)"
      );
    });

    it("throws auth error on 403 response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Authentication expired (403)"
      );
    });

    it("throws generic error on 500 response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      // 500 goes through apiRequest-style path — but fetchCredentials
      // only checks ok, so it throws the generic message.
      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Failed to fetch PowerSync token"
      );
    });

    it("throttles retries with exponential backoff", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(""),
      });

      // First failure → consecutiveErrors becomes 1 → next backoff = 2^1 * 1000 = 2s
      await expect(connector.fetchCredentials()).rejects.toThrow();

      // Within 2s backoff window → throttled
      vi.advanceTimersByTime(1000);
      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Token fetch throttled (offline)"
      );

      // Only one actual fetch was made
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // After the 2s backoff expires, allow retry
      vi.advanceTimersByTime(1001);
      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Failed to fetch PowerSync token"
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second failure → consecutiveErrors becomes 2 → backoff = 2^2 * 1000 = 4s
      vi.advanceTimersByTime(3000);
      await expect(connector.fetchCredentials()).rejects.toThrow(
        "Token fetch throttled (offline)"
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("allows retry after backoff and resets on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve(""),
      });

      // First failure → consecutiveErrors becomes 1 → backoff = 2s
      await expect(connector.fetchCredentials()).rejects.toThrow();

      // Wait past the 2s backoff window
      vi.advanceTimersByTime(2001);

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
            grade1: 85,
            grade2: null,
            grade3: null,
            grade4: null,
            grade5: null,
            grade6: null,
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
          grade1: 85,
          grade2: null,
          grade3: null,
          grade4: null,
          grade5: null,
          grade6: null,
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
        body: JSON.stringify({ id: "sol-uuid", givenName: "New", familyName: "Soldier", cycleId: "c1" }),
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
        headers: { "Content-Type": "application/json" },
      });
    });

    it("uploads soldiers PATCH with snake_case to camelCase mapping", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "soldiers",
          op: UpdateType.PATCH,
          id: "sol-1",
          opData: { given_name: "Updated", id_number: "1234567" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/soldiers/sol-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ givenName: "Updated", idNumber: "1234567" }),
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

    it("does not call transaction.complete() on 5xx errors (will retry)", async () => {
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

    it("drains transaction on 4xx client errors (will not retry)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad request"),
      });

      const db = mockDatabase([
        {
          table: "activity_reports",
          op: UpdateType.PUT,
          id: "r1",
          opData: { activity_id: "a1", soldier_id: "s1", result: "passed" },
        },
      ]);

      await connector.uploadData(db as never);

      const tx = await (db as { getNextCrudTransaction: () => Promise<{ complete: () => void }> }).getNextCrudTransaction();
      expect(tx.complete).toHaveBeenCalled();
    });
  });
});
