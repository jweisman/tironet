"use client";

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

export function ActivityCard({ activity, showPlatoon = false, onClick }: Props) {
  const hasIssues = activity.isRequired && (activity.missingCount > 0 || activity.failedCount > 0);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1.5 py-3 px-4 text-start transition-colors hover:bg-muted/50 active:bg-muted border-s-2",
        hasIssues
          ? "border-amber-400 bg-amber-50/50"
          : "border-transparent"
      )}
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
            activity.passedCount > 0 ? "text-green-600" : "text-muted-foreground"
          )}
        >
          ✓{activity.passedCount}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            activity.failedCount > 0 ? "text-red-600" : "text-muted-foreground"
          )}
        >
          ✗{activity.failedCount}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            activity.missingCount > 0 ? "text-amber-600" : "text-muted-foreground"
          )}
        >
          ⚠{activity.missingCount}
        </span>

        {/* Badges */}
        {activity.isRequired && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
            דרוש
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
