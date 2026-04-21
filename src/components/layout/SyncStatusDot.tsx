"use client";

import { useSyncStatus, type SyncState } from "@/hooks/useSyncStatus";
import { cn } from "@/lib/utils";

const stateStyles: Record<SyncState, string> = {
  synced: "bg-emerald-500",
  syncing: "bg-blue-500 animate-pulse",
  stale: "bg-amber-500",
  error: "bg-red-500",
  initializing: "bg-muted-foreground/40",
};

/**
 * Small colored dot indicating PowerSync sync status.
 * Rendered next to the support icon — both are wrapped in a
 * single Link so tapping either navigates to /support.
 */
export function SyncStatusDot({ size = 8 }: { size?: number }) {
  const { state } = useSyncStatus();

  return (
    <span
      className={cn("inline-block rounded-full shrink-0", stateStyles[state])}
      style={{ width: size, height: size }}
      role="status"
      aria-label={`sync: ${state}`}
    />
  );
}
