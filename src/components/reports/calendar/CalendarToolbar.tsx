"use client";

import type { CalendarFilterCategory } from "@/lib/calendar/events";
import { FILTER_CATEGORY_LABELS } from "@/lib/calendar/events";
import { cn } from "@/lib/utils";

interface CalendarToolbarProps {
  platoons: { id: string; name: string }[];
  selectedPlatoonId: string; // "all" or a specific platoon ID
  onPlatoonChange: (id: string) => void;
  visibleFilters: CalendarFilterCategory[];
  enabledFilters: Set<CalendarFilterCategory>;
  onToggleFilter: (filter: CalendarFilterCategory) => void;
  /** Hide platoon filter for single-platoon users */
  showPlatoonFilter: boolean;
}

export function CalendarToolbar({
  platoons,
  selectedPlatoonId,
  onPlatoonChange,
  visibleFilters,
  enabledFilters,
  onToggleFilter,
  showPlatoonFilter,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showPlatoonFilter && (
        <select
          value={selectedPlatoonId}
          onChange={(e) => onPlatoonChange(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="all">כל המחלקות</option>
          {platoons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {visibleFilters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onToggleFilter(filter)}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            enabledFilters.has(filter)
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-muted/50",
          )}
        >
          {FILTER_CATEGORY_LABELS[filter]}
        </button>
      ))}
    </div>
  );
}
