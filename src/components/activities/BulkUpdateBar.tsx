"use client";

import { cn } from "@/lib/utils";
import type { ResultLabels } from "@/types/display-config";

interface Props {
  onBulkUpdate: (result: "completed" | "skipped" | "na") => void;
  loading?: boolean;
  resultLabels: ResultLabels;
}

export function BulkUpdateBar({ onBulkUpdate, loading = false, resultLabels }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-muted/80 border-b border-border">
      <span className="text-xs text-muted-foreground shrink-0">סמן הכל כ:</span>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={loading}
          onClick={() => onBulkUpdate("completed")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-colors border",
            "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 active:bg-green-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {resultLabels.completed.label} ✓
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onBulkUpdate("skipped")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-colors border",
            "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 active:bg-amber-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {resultLabels.skipped.label} ✗
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onBulkUpdate("na")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-colors border",
            "bg-muted text-muted-foreground border-border hover:bg-muted/80 active:bg-muted",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {resultLabels.na.label} —
        </button>
      </div>
    </div>
  );
}
