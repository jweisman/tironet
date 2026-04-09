"use client";

import { useRef, useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ActivityTypeIcon } from "./ActivityTypeIcon";

export interface ActivitySummary {
  id: string;
  name: string;
  date: string; // ISO string
  status: "draft" | "active";
  isRequired: boolean;
  activityType: { name: string; icon: string };
  platoon: { id: string; name: string; companyName: string };
  passedCount: number;
  failedCount: number;
  naCount: number;
  missingCount: number;
  totalSoldiers: number;
}

interface Props {
  activity: ActivitySummary;
  showPlatoon?: boolean;
  onClick: () => void;
  onLongPress?: (e: { x: number; y: number }) => void;
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

export function ActivityCard({ activity, showPlatoon = false, onClick, onLongPress }: Props) {
  const isPast = activity.date.split("T")[0] < new Date().toISOString().split("T")[0];
  const hasIssues = activity.isRequired && isPast && (activity.missingCount > 0 || activity.failedCount > 0);

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
      type="button"
      onClick={() => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
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
      <div className="flex items-center gap-2 ps-12 flex-wrap">
        {showPlatoon && (
          <span className="text-xs text-muted-foreground">
            {activity.platoon.companyName} / {activity.platoon.name}
          </span>
        )}

        {/* Counts */}
        <span
          className={cn(
            "text-xs font-medium",
            activity.passedCount > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
          )}
        >
          ✓{activity.passedCount}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            activity.failedCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
          )}
        >
          ✗{activity.failedCount}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            activity.missingCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          )}
        >
          ⚠{activity.missingCount}
        </span>

        {/* Badges */}
        {activity.isRequired && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
            חובה
          </Badge>
        )}
        <Badge
          variant={activity.status === "draft" ? "outline" : "default"}
          className="text-xs px-1.5 py-0 h-4"
        >
          {activity.status === "draft" ? "טיוטה" : "פעיל"}
        </Badge>
      </div>
    </button>
  );
}
