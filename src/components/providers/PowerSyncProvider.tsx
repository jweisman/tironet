"use client";

import { useEffect } from "react";
import { PowerSyncContext } from "@powersync/react";
import { db } from "@/lib/powersync/database";
import { TironetConnector } from "@/lib/powersync/connector";

const connector = new TironetConnector();

export function TironetPowerSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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
        // Start sync — may fail offline, PowerSync retries automatically.
        console.log("[PowerSync] calling connect()...");
        return localDb.connect(connector);
      })
      .then(() => {
        console.log("[PowerSync] connect() resolved — sync started");
      })
      .catch((err: unknown) => {
        // Expected when offline — DB is still open from init()
        console.warn("[PowerSync] error (DB still open from init):", err);
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
      {children}
    </PowerSyncContext.Provider>
  );
}
