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
  const msg = err instanceof Error ? err.message : String(err);
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
          Sentry.captureException(status.dataFlowStatus!.downloadError, {
            tags: { component: "powersync", phase: "sync", corrupt: true },
          });
          setDbCorrupt(true);
        }
      },
    });

    // init() opens the local DB and creates tables from the schema.
    // This is fast and works offline — no network needed.
    console.log("[PowerSync] calling init()...");
    performance.mark("powersync-init-start");
    localDb
      .init()
      .then(() => {
        performance.mark("powersync-init-end");
        console.log("[PowerSync] init() resolved — DB open, local queries ready");
        setInitFailed(false);
        // Start sync — may fail offline, PowerSync retries automatically.
        console.log("[PowerSync] calling connect()...");
        performance.mark("powersync-connect-start");
        return localDb.connect(connector);
      })
      .then(() => {
        performance.mark("powersync-connect-end");
        console.log("[PowerSync] connect() resolved — sync started");
      })
      .catch((err: unknown) => {
        if (isCorruptError(err)) {
          console.error("[PowerSync] DB corrupt during init/connect:", err);
          Sentry.captureException(err, {
            tags: { component: "powersync", phase: "init", corrupt: true },
          });
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
      localDb.disconnect().catch(() => {});
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
