import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/web";

interface TokenResponse {
  token: string;
  powersync_url: string;
}

export class TironetConnector implements PowerSyncBackendConnector {
  private cachedToken: TokenResponse | null = null;
  private tokenExpiry = 0;
  private lastFetchError = 0;

  async fetchCredentials() {
    // Return cached token if still valid (with 30s buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry - 30_000) {
      return {
        endpoint: this.cachedToken.powersync_url,
        token: this.cachedToken.token,
      };
    }

    // Throttle retries when offline — don't hammer the network.
    // PowerSync retries fetchCredentials() rapidly; without this guard
    // we'd fire dozens of failing fetches per second.
    const now = Date.now();
    if (this.lastFetchError && now - this.lastFetchError < 10_000) {
      throw new Error("Token fetch throttled (offline)");
    }

    try {
      const res = await fetch("/api/powersync/token");
      if (!res.ok) throw new Error("Failed to fetch PowerSync token");

      const data: TokenResponse = await res.json();
      this.cachedToken = data;
      this.lastFetchError = 0;
      // Tokens are issued with 5m expiry
      this.tokenExpiry = Date.now() + 5 * 60 * 1000;

      console.log("[PowerSync] token fetched OK");
      return {
        endpoint: data.powersync_url,
        token: data.token,
      };
    } catch (err) {
      this.lastFetchError = Date.now();
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
            await fetch(`/api/activity-reports`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                activityId: d.activity_id,
                soldierId: d.soldier_id,
                result: d.result,
                grade: d.grade,
                note: d.note,
              }),
            });
          } else if (opType === UpdateType.PATCH) {
            await fetch(`/api/activity-reports/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opData),
            });
          } else if (opType === UpdateType.DELETE) {
            await fetch(`/api/activity-reports/${id}`, { method: "DELETE" });
          }
        } else if (table === "activities") {
          if (opType === UpdateType.PUT) {
            await fetch(`/api/activities`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, ...opData }),
            });
          } else if (opType === UpdateType.PATCH) {
            await fetch(`/api/activities/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opData),
            });
          } else if (opType === UpdateType.DELETE) {
            await fetch(`/api/activities/${id}`, { method: "DELETE" });
          }
        } else if (table === "soldiers") {
          if (opType === UpdateType.PUT) {
            await fetch(`/api/soldiers`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, ...opData }),
            });
          } else if (opType === UpdateType.PATCH) {
            await fetch(`/api/soldiers/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opData),
            });
          } else if (opType === UpdateType.DELETE) {
            await fetch(`/api/soldiers/${id}`, { method: "DELETE" });
          }
        }
      }

      await transaction.complete();
    } catch (err) {
      // Network errors are expected when offline — PowerSync retries automatically.
      // Only log unexpected errors (not plain fetch failures).
      if (!(err instanceof TypeError && (err as TypeError).message === "Failed to fetch")) {
        console.error("[PowerSync] uploadData error:", err);
      }
      // Do not call transaction.complete() — PowerSync will retry
    }
  }
}
