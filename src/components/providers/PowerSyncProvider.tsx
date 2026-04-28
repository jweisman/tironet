"use client";

import { useEffect, useState } from "react";
import { PowerSyncContext } from "@powersync/react";
import * as Sentry from "@sentry/nextjs";
import { Loader2 } from "lucide-react";
import { db } from "@/lib/powersync/database";
import { TironetConnector } from "@/lib/powersync/connector";
import { clearLocalDatabase } from "@/lib/powersync/clear-local-db";

const connector = new TironetConnector();

function isCorruptError(err: unknown): boolean {
  if (!err) return false;
  // Error may be a plain object from the web worker (Comlink can't
  // transfer Error instances). Check .message first, fall back to String().
  const msg = (err as { message?: string }).message ?? String(err);
  return msg.includes("CORRUPT") || msg.includes("database disk image is malformed");
}

export function TironetPowerSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [initFailed, setInitFailed] = useState(false);
  const [dbCorrupt, setDbCorrupt] = useState(false);

  // Open the local SQLite DB immediately on mount. This makes useQuery()
  // return previously synced data even when offline (before sync starts).
  // connect() additionally starts the sync stream — if fetchCredentials()
  // fails (offline), sync retries in the background while the DB stays open.
  useEffect(() => {
    const localDb = db;
    if (!localDb) return;

    // Dev-only: expose db on window for browser console debugging.
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__powersync = localDb;
    }

    // Watch for corruption errors reactively via status changes.
    // This catches corruption during sync (downloadError) without polling.
    const dispose = localDb.registerListener({
      statusChanged: (status) => {
        if (isCorruptError(status.dataFlowStatus?.downloadError)) {
          console.error("[PowerSync] DB corruption detected via status change");
          const dlErr = status.dataFlowStatus!.downloadError;
          Sentry.captureMessage(
            `DB corruption detected: ${(dlErr as { message?: string }).message ?? String(dlErr)}`,
            {
              level: "error",
              tags: { component: "powersync", phase: "sync", corrupt: true },
            },
          );
          setDbCorrupt(true);
        }
      },
    });

    // init() opens the local DB and creates tables from the schema.
    // This is fast and works offline — no network needed.
    // On iOS, JetSam can kill the PWA process while OPFS file handles are
    // open. On relaunch, init() tries to acquire the stale locks and hangs
    // forever. Race it against a 10s timeout — if it hangs, clear OPFS
    // and reload (same recovery as corruption).
    console.log("[PowerSync] calling init()...");
    performance.mark("powersync-init-start");
    const INIT_TIMEOUT_MS = 10_000;
    const initWithTimeout = Promise.race([
      localDb.init(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), INIT_TIMEOUT_MS)
      ),
    ]);
    initWithTimeout
      .then(async (result) => {
        if (result === "timeout") {
          console.error("[PowerSync] init() timed out after 10s — clearing OPFS and reloading");
          Sentry.captureMessage("PowerSync init() timed out — OPFS lock likely stale from killed process", {
            level: "error",
            tags: { component: "powersync", phase: "init-timeout" },
            extra: { userAgent: navigator.userAgent },
          });
          clearLocalDatabase(); // reloads the page
          return;
        }

        performance.mark("powersync-init-end");
        console.log("[PowerSync] init() resolved — DB open, local queries ready");
        setInitFailed(false);

        // Start sync — may fail offline, PowerSync retries automatically.
        console.log("[PowerSync] calling connect()...");
        performance.mark("powersync-connect-start");
        await localDb.connect(connector);

        performance.mark("powersync-connect-end");
        console.log("[PowerSync] connect() resolved — sync started");
        // Confirm successful rebuild after a DB clear
        try {
          if (sessionStorage.getItem("tironet:db-cleared") === "1") {
            sessionStorage.removeItem("tironet:db-cleared");
            Sentry.captureMessage("DB rebuild successful after corruption recovery", {
              level: "info",
              tags: { component: "powersync", phase: "rebuild-success" },
            });
          }
        } catch {
          // sessionStorage unavailable
        }
      })
      .catch((err: unknown) => {
        if (isCorruptError(err)) {
          console.error("[PowerSync] DB corrupt during init/connect:", err);
          Sentry.captureMessage(
            `DB corruption during init/connect: ${(err as { message?: string }).message ?? String(err)}`,
            {
              level: "error",
              tags: { component: "powersync", phase: "init", corrupt: true },
            },
          );
          setDbCorrupt(true);
          return;
        }
        // Distinguish init() failure (OPFS corruption, quota, private browsing)
        // from connect() failure (offline — expected, DB still usable).
        if (!localDb.currentStatus?.hasSynced && !localDb.connected) {
          console.error("[PowerSync] init() failed — offline mode unavailable:", err);
          setInitFailed(true);
          Sentry.captureException(err, {
            tags: { component: "powersync", phase: "init" },
            extra: { userAgent: navigator.userAgent },
          });
        } else {
          console.warn("[PowerSync] connect() failed (DB still open from init):", err);
        }
      });

    // Report if sync hasn't completed after 30 seconds — helps diagnose
    // cases where the DB opens but no data arrives (e.g. unsupported browser)
    const syncTimeout = setTimeout(() => {
      if (localDb && !localDb.currentStatus?.hasSynced) {
        Sentry.captureMessage("PowerSync sync not completed after 30s", {
          level: "warning",
          tags: { component: "powersync", phase: "sync-timeout" },
          extra: {
            userAgent: navigator.userAgent,
            connected: localDb.connected,
            status: JSON.stringify(localDb.currentStatus),
          },
        });
      }
    }, 30_000);

    return () => {
      dispose();
      clearTimeout(syncTimeout);
      // Do NOT call localDb.disconnect() here. The DB is a module-level
      // singleton — disconnecting during useEffect cleanup (HMR, StrictMode,
      // or Safari tab suspension/resume) leaves OPFS file handles in a broken
      // state, causing the next init() to deadlock on waitForReady().
      // The DB persists for the lifetime of the page; cleanup only needs to
      // remove listeners and timers.
    };
  }, []);

  // Auto-clear corrupt DB — no user action needed.
  useEffect(() => {
    if (!dbCorrupt) return;
    clearLocalDatabase();
  }, [dbCorrupt]);

  if (!db) {
    // SSR — just render children without PowerSync context
    return <>{children}</>;
  }

  return (
    <PowerSyncContext.Provider value={db}>
      {dbCorrupt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
            <p className="text-sm font-medium">מאפס נתונים מקומיים וטוען מחדש...</p>
          </div>
        </div>
      )}
      {initFailed && !dbCorrupt && (
        <div
          role="alert"
          className="fixed top-0 inset-x-0 z-50 bg-destructive text-destructive-foreground text-center text-xs py-1.5 px-4"
        >
          מצב לא מקוון אינו זמין — נדרש חיבור לרשת
        </div>
      )}
      {children}
    </PowerSyncContext.Provider>
  );
}
