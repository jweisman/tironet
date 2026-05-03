import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/web";

interface TokenResponse {
  token: string;
  powersync_url: string;
}

/** Wrapper around fetch that throws on non-OK responses so the CRUD
 *  transaction is not marked complete and PowerSync retries later. */
async function apiRequest(url: string, method: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${method} ${url} → ${res.status}: ${text}`);
  }
}

export class TironetConnector implements PowerSyncBackendConnector {
  private cachedToken: TokenResponse | null = null;
  private tokenExpiry = 0;
  private lastFetchError = 0;
  /** Consecutive network-error count — drives exponential backoff. */
  private consecutiveErrors = 0;

  async fetchCredentials() {
    // Return cached token if still valid (with 30s buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry - 30_000) {
      return {
        endpoint: this.cachedToken.powersync_url,
        token: this.cachedToken.token,
      };
    }

    // Exponential backoff when offline — don't hammer the network.
    // PowerSync retries fetchCredentials() rapidly; without this guard
    // we'd fire dozens of failing fetches per second.
    const now = Date.now();
    if (this.lastFetchError) {
      const backoff = Math.min(1000 * 2 ** this.consecutiveErrors, 30_000);
      if (now - this.lastFetchError < backoff) {
        throw new Error("Token fetch throttled (offline)");
      }
    }

    try {
      const res = await fetch("/api/powersync/token");

      // Auth failure — session expired or revoked. Clear cached token and
      // throw a distinguishable error so callers can prompt re-login.
      if (res.status === 401 || res.status === 403) {
        this.cachedToken = null;
        this.tokenExpiry = 0;
        throw new Error(
          `Authentication expired (${res.status}) — please sign in again`
        );
      }

      if (!res.ok) throw new Error("Failed to fetch PowerSync token");

      const data: TokenResponse = await res.json();
      this.cachedToken = data;
      this.lastFetchError = 0;
      this.consecutiveErrors = 0;
      // Tokens are issued with 5m expiry
      this.tokenExpiry = Date.now() + 5 * 60 * 1000;

      console.log("[PowerSync] token fetched OK");
      return {
        endpoint: data.powersync_url,
        token: data.token,
      };
    } catch (err) {
      this.lastFetchError = Date.now();
      this.consecutiveErrors++;
      throw err;
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    try {
      for (const op of transaction.crud) {
        const { table, op: opType, id, opData } = op;

        if (table === "activity_reports") {
          if (opType === UpdateType.PUT) {
            // opData uses snake_case column names from the local schema.
            // Transform to camelCase for the API, and pass the client id so
            // the server creates the record with the same UUID.
            const d = opData as Record<string, unknown>;
            await apiRequest("/api/activity-reports", "POST", {
              id,
              activityId: d.activity_id,
              soldierId: d.soldier_id,
              result: d.result,
              failed: Boolean(d.failed),
              grade1: d.grade1,
              grade2: d.grade2,
              grade3: d.grade3,
              grade4: d.grade4,
              grade5: d.grade5,
              grade6: d.grade6,
              note: d.note,
            });
          } else if (opType === UpdateType.PATCH) {
            // The composite key (activityId + soldierId) may be in opData
            // (included in the UPDATE SET clause) or fetched from the local
            // row. opData is preferred — the local row's id may have changed
            // during sync if another client created the row first.
            const d = opData as Record<string, unknown>;
            let activityId = d.activity_id as string | undefined;
            let soldierId = d.soldier_id as string | undefined;
            if (!activityId || !soldierId) {
              const row = await database.get<Record<string, unknown>>(
                "SELECT activity_id, soldier_id FROM activity_reports WHERE id = ?",
                [id]
              );
              if (row) {
                activityId = row.activity_id as string;
                soldierId = row.soldier_id as string;
              }
            }
            const patchData: Record<string, unknown> = {
              ...opData,
              ...(activityId && soldierId ? { activityId, soldierId } : {}),
            };
            // PowerSync stores booleans as integers (0/1); convert for the API
            if ("failed" in patchData) patchData.failed = Boolean(patchData.failed);
            await apiRequest(`/api/activity-reports/${id}`, "PATCH", patchData);
          } else if (opType === UpdateType.DELETE) {
            await apiRequest(`/api/activity-reports/${id}`, "DELETE");
          }
        } else if (table === "activities") {
          if (opType === UpdateType.PUT) {
            await apiRequest("/api/activities", "POST", { id, ...opData });
          } else if (opType === UpdateType.PATCH) {
            const d = opData as Record<string, unknown>;
            const body: Record<string, unknown> = {};
            if (d.name !== undefined) body.name = d.name;
            if (d.date !== undefined) body.date = d.date;
            if (d.activity_type_id !== undefined) body.activityTypeId = d.activity_type_id;
            if (d.is_required !== undefined) body.isRequired = Boolean(d.is_required);
            if (d.status !== undefined) body.status = d.status;
            await apiRequest(`/api/activities/${id}`, "PATCH", body);
          } else if (opType === UpdateType.DELETE) {
            await apiRequest(`/api/activities/${id}`, "DELETE");
          }
        } else if (table === "requests") {
          if (opType === UpdateType.PUT) {
            const d = opData as Record<string, unknown>;
            // Don't send status/assignedRole — the server determines these
            // based on the creator's role.
            await apiRequest("/api/requests", "POST", {
              id,
              cycleId: d.cycle_id,
              soldierId: d.soldier_id,
              type: d.type,
              description: d.description,
              place: d.place,
              departureAt: d.departure_at,
              returnAt: d.return_at,
              transportation: d.transportation,
              urgent: d.urgent != null ? Boolean(d.urgent) : undefined,
              paramedicDate: d.paramedic_date,
              medicalAppointments: d.medical_appointments ? JSON.parse(d.medical_appointments as string) : undefined,
              sickDays: d.sick_days ? JSON.parse(d.sick_days as string) : undefined,
              specialConditions: d.special_conditions != null ? Boolean(d.special_conditions) : undefined,
            });
          } else if (opType === UpdateType.PATCH) {
            const d = opData as Record<string, unknown>;
            // Transform snake_case to camelCase for the API
            const body: Record<string, unknown> = {};
            const mapping: Record<string, string> = {
              cycle_id: "cycleId", soldier_id: "soldierId",
              assigned_role: "assignedRole", created_by_user_id: "createdByUserId",
              departure_at: "departureAt", return_at: "returnAt",
              paramedic_date: "paramedicDate", medical_appointments: "medicalAppointments",
              sick_days: "sickDays", special_conditions: "specialConditions",
            };
            for (const [key, value] of Object.entries(d)) {
              body[mapping[key] ?? key] = value;
            }
            // Convert integer booleans back
            if ("urgent" in body) body.urgent = body.urgent != null ? Boolean(body.urgent) : undefined;
            if ("specialConditions" in body) body.specialConditions = body.specialConditions != null ? Boolean(body.specialConditions) : undefined;
            // Parse JSON string fields
            if ("medicalAppointments" in body && typeof body.medicalAppointments === "string") {
              try { body.medicalAppointments = JSON.parse(body.medicalAppointments as string); } catch { /* keep as-is */ }
            }
            if ("sickDays" in body && typeof body.sickDays === "string") {
              try { body.sickDays = JSON.parse(body.sickDays as string); } catch { /* keep as-is */ }
            }
            await apiRequest(`/api/requests/${id}`, "PATCH", body);
          } else if (opType === UpdateType.DELETE) {
            await apiRequest(`/api/requests/${id}`, "DELETE");
          }
        } else if (table === "request_actions") {
          if (opType === UpdateType.PUT) {
            const d = opData as Record<string, unknown>;
            await apiRequest("/api/request-actions", "POST", {
              id,
              requestId: d.request_id,
              action: d.action,
              note: d.note,
              userName: d.user_name,
            });
          } else if (opType === UpdateType.PATCH) {
            const d = opData as Record<string, unknown>;
            await apiRequest(`/api/request-actions/${id}`, "PATCH", {
              note: d.note ?? null,
            });
          }
          // No DELETE for actions
        } else if (table === "soldiers") {
          const soldierMapping: Record<string, string> = {
            cycle_id: "cycleId", squad_id: "squadId",
            given_name: "givenName", family_name: "familyName",
            id_number: "idNumber", civilian_id: "civilianId", profile_image: "profileImage",
            emergency_phone: "emergencyPhone", emergency_contact_name: "emergencyContactName",
            emergency_contact_relationship: "emergencyContactRelationship", date_of_birth: "dateOfBirth",
          };
          function mapSoldierData(d: Record<string, unknown>) {
            const body: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(d)) {
              body[soldierMapping[key] ?? key] = value;
            }
            return body;
          }
          if (opType === UpdateType.PUT) {
            await apiRequest("/api/soldiers", "POST", { id, ...mapSoldierData(opData as Record<string, unknown>) });
          } else if (opType === UpdateType.PATCH) {
            await apiRequest(`/api/soldiers/${id}`, "PATCH", mapSoldierData(opData as Record<string, unknown>));
          } else if (opType === UpdateType.DELETE) {
            await apiRequest(`/api/soldiers/${id}`, "DELETE");
          }
        } else if (table === "incidents") {
          const incidentMapping: Record<string, string> = {
            soldier_id: "soldierId", created_by_name: "createdByName",
            created_by_user_id: "createdByUserId",
          };
          function mapIncidentData(d: Record<string, unknown>) {
            const body: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(d)) {
              body[incidentMapping[key] ?? key] = value;
            }
            return body;
          }
          if (opType === UpdateType.PUT) {
            await apiRequest("/api/incidents", "POST", { id, ...mapIncidentData(opData as Record<string, unknown>) });
          } else if (opType === UpdateType.PATCH) {
            await apiRequest(`/api/incidents/${id}`, "PATCH", mapIncidentData(opData as Record<string, unknown>));
          } else if (opType === UpdateType.DELETE) {
            await apiRequest(`/api/incidents/${id}`, "DELETE");
          }
        } else if (table === "home_visits") {
          const homeVisitMapping: Record<string, string> = {
            soldier_id: "soldierId", created_by_name: "createdByName",
            created_by_user_id: "createdByUserId",
          };
          function mapHomeVisitData(d: Record<string, unknown>) {
            const body: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(d)) {
              body[homeVisitMapping[key] ?? key] = value;
            }
            return body;
          }
          if (opType === UpdateType.PUT) {
            await apiRequest("/api/home-visits", "POST", { id, ...mapHomeVisitData(opData as Record<string, unknown>) });
          } else if (opType === UpdateType.PATCH) {
            await apiRequest(`/api/home-visits/${id}`, "PATCH", mapHomeVisitData(opData as Record<string, unknown>));
          } else if (opType === UpdateType.DELETE) {
            await apiRequest(`/api/home-visits/${id}`, "DELETE");
          }
        }
      }

      await transaction.complete();
    } catch (err) {
      // Network errors are expected when offline — PowerSync retries automatically.
      if (err instanceof TypeError && err.message === "Failed to fetch") {
        // Offline — do not complete the transaction so PowerSync retries later.
        return;
      }

      console.error("[PowerSync] uploadData error:", err);

      // If the server returned a 4xx client error (bad data, permission denied),
      // retrying will never succeed. Complete the transaction to drain the bad
      // operation from the queue so it doesn't block subsequent uploads.
      const is4xx = err instanceof Error && /→ 4\d{2}:/.test(err.message);
      if (is4xx) {
        console.warn("[PowerSync] Draining failed transaction (4xx — will not retry)");
        await transaction.complete();
      }
      // For 5xx or other unexpected errors, leave the transaction incomplete
      // so PowerSync retries automatically.
    }
  }
}
