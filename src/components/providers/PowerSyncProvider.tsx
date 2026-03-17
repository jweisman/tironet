"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { PowerSyncContext } from "@powersync/react";
import { db } from "@/lib/powersync/database";
import { TironetConnector } from "@/lib/powersync/connector";

const connector = new TironetConnector();

export function TironetPowerSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();

  useEffect(() => {
    const localDb = db;
    if (!localDb) return;

    // Dev-only: expose db on window for browser console debugging.
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__powersync = localDb;
    }

    if (status === "authenticated") {
      localDb.connect(connector).catch((err: unknown) => {
        console.error("[PowerSync] connect error:", err);
      });
    } else if (status === "unauthenticated") {
      localDb.disconnect().catch(() => {});
    }
  }, [status]);

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
