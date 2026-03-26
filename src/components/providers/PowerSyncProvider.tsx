"use client";

import { useEffect, useState } from "react";
import { PowerSyncContext } from "@powersync/react";
import { db } from "@/lib/powersync/database";
import { TironetConnector } from "@/lib/powersync/connector";

const connector = new TironetConnector();

export function TironetPowerSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [initFailed, setInitFailed] = useState(false);

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

    // init() opens the local DB and creates tables from the schema.
    // This is fast and works offline — no network needed.
    console.log("[PowerSync] calling init()...");
    localDb
      .init()
      .then(() => {
        console.log("[PowerSync] init() resolved — DB open, local queries ready");
        setInitFailed(false);
        // Start sync — may fail offline, PowerSync retries automatically.
        console.log("[PowerSync] calling connect()...");
        return localDb.connect(connector);
      })
      .then(() => {
        console.log("[PowerSync] connect() resolved — sync started");
      })
      .catch((err: unknown) => {
        // Distinguish init() failure (OPFS corruption, quota, private browsing)
        // from connect() failure (offline — expected, DB still usable).
        if (!localDb.currentStatus?.hasSynced && !localDb.connected) {
          console.error("[PowerSync] init() failed — offline mode unavailable:", err);
          setInitFailed(true);
        } else {
          console.warn("[PowerSync] connect() failed (DB still open from init):", err);
        }
      });

    return () => {
      localDb.disconnect().catch(() => {});
    };
  }, []);

  if (!db) {
    // SSR — just render children without PowerSync context
    return <>{children}</>;
  }

  return (
    <PowerSyncContext.Provider value={db}>
      {initFailed && (
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
