"use client";

import { memo, useRef, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ActivityTypeIcon } from "./ActivityTypeIcon";
import { ActivityProgressBar, type ActivityCounts } from "./ActivityProgressBar";

export interface ActivitySummary {
  id: string;
  name: string;
  date: string; // ISO string
  isRequired: boolean;
  activityType: { name: string; icon: string };
  platoon: { id: string; name: string; companyName: string };
  counts: ActivityCounts;
}

interface Props {
  activity: ActivitySummary;
  showPlatoon?: boolean;
  onClick: () => void;
  onLongPress?: (e: { x: number; y: number }) => void;
  dataTour?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

function formatDate(isoString: string): string {
  const dateStr = isoString.split("T")[0];
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const ActivityCard = memo(function ActivityCard({ activity, showPlatoon = false, onClick, onLongPress, dataTour, selectable, selected, onToggleSelect }: Props) {
  const isPast = activity.date.split("T")[0] < new Date().toISOString().split("T")[0];
  const c = activity.counts;
  const hasIssues = activity.isRequired && isPast && (c.missing > 0 || c.skipped > 0 || c.failed > 0);

  // Long-press detection for mobile
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onLongPress) return;
    suppressClickRef.current = false;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      suppressClickRef.current = true;
      onLongPress({ x, y });
    }, 500);
  }, [onLongPress]);

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onLongPress) return;
    e.preventDefault();
    suppressClickRef.current = true;
    onLongPress({ x: e.clientX, y: e.clientY });
  }, [onLongPress]);

  return (
    <button
      data-tour={dataTour}
      type="button"
      onClick={() => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        if (selectable && onToggleSelect) { onToggleSelect(); return; }
        onClick();
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      className={cn(
        "flex w-full flex-col gap-1.5 py-3 px-4 text-start transition-colors hover:bg-muted/50 active:bg-muted border-b border-b-border border-s-2",
        hasIssues
          ? "border-s-amber-400 bg-amber-50/50 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 dark:border-s-amber-600"
          : "border-s-transparent"
      )}
      style={onLongPress ? { WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties : undefined}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 w-full">
        {selectable && (
          <div className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
            selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
          )}>
            {selected && <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
          </div>
        )}
        {/* Activity type icon circle */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          <ActivityTypeIcon
            icon={activity.activityType.icon}
            name={activity.activityType.name}
            size={18}
          />
        </div>

        {/* Name */}
        <span className="flex-1 min-w-0 font-semibold text-sm truncate">
          {activity.name}
        </span>

        {/* Date */}
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(activity.date)}
        </span>

        {/* Chevron */}
        <ChevronLeft size={16} className="shrink-0 text-muted-foreground" />
      </div>

      {/* Sub-row */}
      <div className="flex flex-col gap-1.5 ps-12">
        {showPlatoon && (
          <span className="text-xs text-muted-foreground">
            {activity.platoon.companyName} / {activity.platoon.name}
          </span>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ActivityProgressBar counts={c} />
          </div>
          {activity.isRequired && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 shrink-0">
              חובה
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
});
