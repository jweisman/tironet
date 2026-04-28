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
    function mockDatabase(
      crud: Array<{ table: string; op: UpdateType; id: string; opData?: Record<string, unknown> }>,
      getResult?: Record<string, unknown> | null,
    ) {
      return {
        getNextCrudTransaction: vi.fn().mockResolvedValue({
          crud,
          complete: vi.fn(),
        }),
        get: vi.fn().mockResolvedValue(getResult ?? null),
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

    it("uploads activity_report PATCH with composite key from local row", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase(
        [
          {
            table: "activity_reports",
            op: UpdateType.PATCH,
            id: "report-1",
            opData: { result: "failed" },
          },
        ],
        { activity_id: "act-1", soldier_id: "sol-1" },
      );

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/activity-reports/report-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: "failed", activityId: "act-1", soldierId: "sol-1" }),
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

    it("maps date_of_birth to dateOfBirth in soldiers PATCH", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "soldiers",
          op: UpdateType.PATCH,
          id: "sol-1",
          opData: { date_of_birth: "2007-05-15" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/soldiers/sol-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateOfBirth: "2007-05-15" }),
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

    // --- Requests ---

    it("uploads requests PUT with snake_case to camelCase transform", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "requests",
          op: UpdateType.PUT,
          id: "req-uuid",
          opData: {
            cycle_id: "c1",
            soldier_id: "s1",
            type: "leave",
            description: "Family visit",
            place: "Tel Aviv",
            departure_at: "2026-04-10T08:00:00Z",
            return_at: "2026-04-12T18:00:00Z",
            transportation: "bus",
            urgent: null,
            paramedic_date: null,
            medical_appointments: null,
            sick_days: null,
            special_conditions: null,
          },
        },
      ]);

      await connector.uploadData(db as never);

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as { body: string }).body,
      );
      expect(body.id).toBe("req-uuid");
      expect(body.cycleId).toBe("c1");
      expect(body.soldierId).toBe("s1");
      expect(body.type).toBe("leave");
      expect(body.description).toBe("Family visit");
      expect(body.place).toBe("Tel Aviv");
      expect(body.departureAt).toBe("2026-04-10T08:00:00Z");
      expect(body.returnAt).toBe("2026-04-12T18:00:00Z");
      expect(body.transportation).toBe("bus");
      expect(body.sickDays).toBeUndefined();
    });

    it("uploads requests PUT with medical_appointments JSON parsing", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const appts = JSON.stringify([{ id: "a1", date: "2026-04-20", place: "Hospital", type: "Checkup" }]);
      const sickDays = JSON.stringify([{ id: "d1", date: "2026-04-15" }, { id: "d2", date: "2026-04-16" }]);
      const db = mockDatabase([
        {
          table: "requests",
          op: UpdateType.PUT,
          id: "req-med",
          opData: {
            cycle_id: "c1",
            soldier_id: "s1",
            type: "medical",
            description: null,
            place: null,
            departure_at: null,
            return_at: null,
            transportation: null,
            urgent: 1,
            paramedic_date: "2026-04-18",
            medical_appointments: appts,
            sick_days: sickDays,
            special_conditions: null,
          },
        },
      ]);

      await connector.uploadData(db as never);

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as { body: string }).body,
      );
      expect(body.medicalAppointments).toEqual([{ id: "a1", date: "2026-04-20", place: "Hospital", type: "Checkup" }]);
      expect(body.urgent).toBe(true);
      expect(body.paramedicDate).toBe("2026-04-18");
      expect(body.sickDays).toEqual([{ id: "d1", date: "2026-04-15" }, { id: "d2", date: "2026-04-16" }]);
    });

    it("uploads requests PATCH with snake_case to camelCase mapping", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "requests",
          op: UpdateType.PATCH,
          id: "req-1",
          opData: {
            status: "approved",
            assigned_role: "company_commander",
          },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/requests/req-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "approved",
          assignedRole: "company_commander",
        }),
      });
    });

    it("uploads requests PATCH with boolean conversion for urgent/specialConditions", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "requests",
          op: UpdateType.PATCH,
          id: "req-2",
          opData: {
            urgent: 1,
            special_conditions: 0,
          },
        },
      ]);

      await connector.uploadData(db as never);

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as { body: string }).body,
      );
      expect(body.urgent).toBe(true);
      expect(body.specialConditions).toBe(false);
    });

    it("uploads requests PATCH with medicalAppointments JSON string parsing", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const appts = JSON.stringify([{ id: "a1", date: "2026-04-20", place: "Clinic", type: "Visit" }]);
      const db = mockDatabase([
        {
          table: "requests",
          op: UpdateType.PATCH,
          id: "req-3",
          opData: {
            medical_appointments: appts,
          },
        },
      ]);

      await connector.uploadData(db as never);

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as { body: string }).body,
      );
      expect(body.medicalAppointments).toEqual([{ id: "a1", date: "2026-04-20", place: "Clinic", type: "Visit" }]);
    });

    it("uploads requests DELETE", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "requests",
          op: UpdateType.DELETE,
          id: "req-del",
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/requests/req-del", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
    });

    // --- Request Actions ---

    it("uploads request_actions PUT with camelCase transform", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "request_actions",
          op: UpdateType.PUT,
          id: "ra-uuid",
          opData: {
            request_id: "req-1",
            action: "approve",
            note: "Approved",
            user_name: "Cohen Avi",
          },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/request-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "ra-uuid",
          requestId: "req-1",
          action: "approve",
          note: "Approved",
          userName: "Cohen Avi",
        }),
      });
    });

    it("uploads request_actions PATCH with note", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "request_actions",
          op: UpdateType.PATCH,
          id: "ra-1",
          opData: { note: "Updated note" },
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/request-actions/ra-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Updated note" }),
      });
    });

    it("uploads request_actions PATCH with null note", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "request_actions",
          op: UpdateType.PATCH,
          id: "ra-2",
          opData: {},
        },
      ]);

      await connector.uploadData(db as never);

      expect(mockFetch).toHaveBeenCalledWith("/api/request-actions/ra-2", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: null }),
      });
    });

    // --- Activities PATCH with field mapping ---

    it("uploads activities PATCH with snake_case to camelCase field mapping", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const db = mockDatabase([
        {
          table: "activities",
          op: UpdateType.PATCH,
          id: "act-2",
          opData: {
            activity_type_id: "type-1",
            is_required: 1,
            status: "active",
            date: "2026-04-20",
          },
        },
      ]);

      await connector.uploadData(db as never);

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as { body: string }).body,
      );
      expect(body).toEqual({
        date: "2026-04-20",
        activityTypeId: "type-1",
        isRequired: true,
        status: "active",
      });
    });
  });
});
