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

  // Delete OPFS database files
  let deletedCount = 0;
  try {
    const root = await navigator.storage.getDirectory();
    const filenames = ["tironet.db", "tironet.db-journal", "tironet.db-wal"];
    for (const name of filenames) {
      try {
        await root.removeEntry(name);
        deletedCount++;
      } catch {
        // File may not exist — that's fine
      }
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { component: "powersync", phase: "clear-local-db-opfs" },
    });
  }

  // Flush Sentry events before reload — sendBeacon ensures delivery
  // even though we're about to navigate away.
  Sentry.captureMessage(`clearLocalDatabase: deleted ${deletedCount} OPFS files, reloading`, {
    level: "info",
    tags: { component: "powersync", phase: "clear-local-db" },
  });
  await Sentry.flush(2000);

  // Reload to reinitialize PowerSync with a fresh DB
  window.location.reload();
}
