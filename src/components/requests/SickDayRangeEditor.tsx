"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { SickDay } from "@/lib/requests/sick-days";

export interface SickDayRange {
  id: string;
  from: string;
  to: string;
}

interface Props {
  /** Existing sick days shown as chips. */
  days: SickDay[];
  /** Called when an existing day chip is deleted. */
  onDeleteDay?: (id: string) => void;
  /** Pending ranges being added. */
  ranges: SickDayRange[];
  /** Called when ranges change (add/edit/remove). */
  onRangesChange: (ranges: SickDayRange[]) => void;
}

/**
 * Controlled sick-day editor. Shows existing days as chips (optionally
 * deletable) and pending date-range inputs for adding new days.
 * Used by both the create form and the detail-page SickDaysSection.
 */
export function SickDayRangeEditor({ days, onDeleteDay, ranges, onRangesChange }: Props) {
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-2">
      {/* Existing days as chips */}
      {days.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <span
              key={d.id}
              className={cn("inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs", d.date >= today && "font-bold")}
            >
              {new Date(d.date + "T00:00:00").toLocaleDateString("he-IL")}
              {onDeleteDay && (
                <button
                  type="button"
                  onClick={() => onDeleteDay(d.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Range inputs */}
      {ranges.map((range) => (
        <div key={range.id} className="rounded-lg border border-border p-2 space-y-1.5">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onRangesChange(ranges.filter((r) => r.id !== range.id))}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <Label className="text-xs">מתאריך</Label>
              <Input
                type="date"
                value={range.from}
                onChange={(e) =>
                  onRangesChange(ranges.map((r) => (r.id === range.id ? { ...r, from: e.target.value } : r)))
                }
                dir="ltr"
                lang="he"
                className="w-full min-w-0"
                style={range.from ? undefined : { color: "transparent" }}
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-xs">עד תאריך</Label>
              <Input
                type="date"
                value={range.to}
                onChange={(e) =>
                  onRangesChange(ranges.map((r) => (r.id === range.id ? { ...r, to: e.target.value } : r)))
                }
                min={range.from || undefined}
                dir="ltr"
                lang="he"
                className="w-full min-w-0"
                style={range.to ? undefined : { color: "transparent" }}
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onRangesChange([...ranges, { id: crypto.randomUUID(), from: "", to: "" }])}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors w-full justify-center"
      >
        <Plus size={14} />
        הוסף ימי מחלה
      </button>
    </div>
  );
}
