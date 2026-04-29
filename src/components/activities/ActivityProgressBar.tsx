"use client";

import { cn } from "@/lib/utils";

export interface ActivityCounts {
  completed: number;
  skipped: number;
  failed: number;
  na: number;
  missing: number;
  total: number;
}

const SEGMENTS: { key: keyof Omit<ActivityCounts, "total">; bar: string; text: string; label: string }[] = [
  { key: "completed", bar: "bg-green-500 dark:bg-green-400", text: "text-green-600 dark:text-green-400", label: "✓" },
  { key: "skipped",   bar: "bg-amber-500 dark:bg-amber-400", text: "text-amber-600 dark:text-amber-400", label: "✗" },
  { key: "failed",    bar: "bg-red-500 dark:bg-red-400",     text: "text-red-600 dark:text-red-400",     label: "!" },
  { key: "na",        bar: "bg-muted-foreground/30",         text: "text-muted-foreground",              label: "—" },
  { key: "missing",   bar: "bg-gray-200 dark:bg-gray-700",   text: "text-muted-foreground",              label: "⚠" },
];

/** Compact stacked progress bar for activity report summaries. */
export function ActivityProgressBar({ counts }: { counts: ActivityCounts }) {
  const total = counts.total || 1;
  const reported = counts.total - counts.missing;
  const isComplete = counts.missing === 0 && counts.skipped === 0 && counts.failed === 0 && counts.total > 0;

  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        {SEGMENTS.map(({ key, bar }) => {
          const pct = (counts[key] / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={key}
              className={cn("h-full transition-all duration-300", bar)}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <span
        className={cn(
          "text-xs font-bold tabular-nums shrink-0",
          isComplete ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
        )}
      >
        {reported}/{counts.total}
      </span>
    </div>
  );
}

/** Inline text counts (✓4 ✗1 !2 ⚠3) for compact displays. */
export function ActivityCountBadges({ counts }: { counts: ActivityCounts }) {
  return (
    <div className="flex items-center gap-2">
      {SEGMENTS.map(({ key, text, label }) => {
        const val = counts[key];
        if (val === 0) return null;
        return (
          <span key={key} className={cn("text-xs font-medium", text)}>
            {label}{val}
          </span>
        );
      })}
    </div>
  );
}
