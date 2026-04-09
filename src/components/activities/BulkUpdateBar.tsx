"use client";

import { cn } from "@/lib/utils";
import type { ResultLabels } from "@/types/display-config";

interface Props {
  onBulkUpdate: (result: "passed" | "failed" | "na") => void;
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
          onClick={() => onBulkUpdate("passed")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-colors border",
            "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 active:bg-green-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {resultLabels.passed.label} ✓
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onBulkUpdate("failed")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-colors border",
            "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 active:bg-red-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {resultLabels.failed.label} ✗
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
