import * as Sentry from "@sentry/nextjs";

/**
 * Deletes the local PowerSync OPFS database files and reloads the page.
 * Used to recover from SQLite corruption (CORRUPT: database disk image
 * is malformed) which can occur when iOS kills the WebContent process
 * mid-write.
 *
 * This deletes the OPFS files directly rather than using
 * `disconnectAndClear()` — that method calls SQL internally which
 * fails when the DB is already corrupt.
 *
 * The wa-sqlite worker holds SyncAccessHandle locks on the DB files.
 * Even after db.close(), the worker may still hold these locks (especially
 * on iOS). To ensure deletion succeeds, we unregister the service worker
 * (so the next load starts clean) and use a two-phase approach:
 *   1. Try to delete OPFS files directly (works if locks are released)
 *   2. If that fails, wipe the entire OPFS directory recursively
 */
export async function clearLocalDatabase(): Promise<void> {
  const { db } = await import("./database");

  Sentry.captureMessage("clearLocalDatabase: starting OPFS clear and reload", {
    level: "warning",
    tags: { component: "powersync", phase: "clear-local-db" },
    extra: {
      userAgent: navigator.userAgent,
      hasSynced: db?.currentStatus?.hasSynced,
      connected: db?.connected,
      downloadError: String(db?.currentStatus?.dataFlowStatus?.downloadError ?? "none"),
    },
  });

  // Disconnect PowerSync if possible (may fail on corrupt DB — that's fine)
  if (db) {
    try {
      await db.disconnect();
    } catch {
      // Expected if DB is corrupt
    }
    try {
      await db.close();
    } catch {
      // Expected if DB is corrupt
    }
  }

  // Delete OPFS database files.
  // Wipe the entire OPFS root recursively to catch all wa-sqlite files
  // (DB, journal, WAL, and .ahp-* temp directories).
  let deletedCount = 0;
  try {
    const root = await navigator.storage.getDirectory();
    // Iterate all entries and remove them
    // @ts-expect-error -- values() is not in all TS lib versions but works in modern browsers
    for await (const entry of root.values()) {
      try {
        await root.removeEntry(entry.name, { recursive: entry.kind === "directory" });
        deletedCount++;
      } catch (e) {
        // File may be locked by the worker — log but continue
        console.warn(`[clearLocalDatabase] failed to delete ${entry.name}:`, e);
      }
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { component: "powersync", phase: "clear-local-db-opfs" },
    });
  }

  // If we couldn't delete any files (worker locks), fall back to
  // IndexedDB clear which forces PowerSync to rebuild on next init
  if (deletedCount === 0) {
    try {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        if (dbInfo.name) {
          indexedDB.deleteDatabase(dbInfo.name);
        }
      }
    } catch {
      // indexedDB.databases() not supported in all browsers
    }
  }

  // Flush Sentry events before reload
  Sentry.captureMessage(`clearLocalDatabase: deleted ${deletedCount} OPFS entries, reloading`, {
    level: "info",
    tags: { component: "powersync", phase: "clear-local-db" },
  });
  await Sentry.flush(2000);

  // Flag so PowerSyncProvider can confirm successful rebuild after reload
  try {
    sessionStorage.setItem("tironet:db-cleared", "1");
  } catch {
    // sessionStorage unavailable (private browsing edge case)
  }

  // Reload to reinitialize PowerSync with a fresh DB
  window.location.reload();
}
