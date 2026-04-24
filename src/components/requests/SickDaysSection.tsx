"use client";

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { parseSickDays, expandSickDayRange } from "@/lib/requests/sick-days";
import type { SickDay } from "@/lib/requests/sick-days";
import { SickDayRangeEditor } from "./SickDayRangeEditor";
import type { SickDayRange } from "./SickDayRangeEditor";

interface Props {
  requestId: string;
  sickDaysJson: string | null;
  canEdit: boolean;
}

export function SickDaysSection({ requestId, sickDaysJson, canEdit }: Props) {
  const db = usePowerSync();
  const days = parseSickDays(sickDaysJson);
  const today = new Date().toISOString().split("T")[0];

  const [editing, setEditing] = useState(false);
  const [ranges, setRanges] = useState<SickDayRange[]>([]);

  async function saveDays(updated: SickDay[]) {
    const sorted = [...updated].sort((a, b) => a.date.localeCompare(b.date));
    try {
      await db.execute(
        `UPDATE requests SET sick_days = ?, updated_at = ? WHERE id = ?`,
        [sorted.length > 0 ? JSON.stringify(sorted) : null, new Date().toISOString(), requestId],
      );
    } catch {
      toast.error("שגיאה בעדכון ימי מחלה");
    }
  }

  function startEditing() {
    setRanges([]);
    setEditing(true);
  }

  async function handleDeleteDay(id: string) {
    const updated = days.filter((s) => s.id !== id);
    await saveDays(updated);
  }

  async function saveAndClose() {
    const existing = new Set(days.map((d) => d.date));
    const newDays: SickDay[] = [];
    for (const range of ranges) {
      if (!range.from) continue;
      for (const d of expandSickDayRange(range.from, range.to || null)) {
        if (!existing.has(d.date)) {
          existing.add(d.date);
          newDays.push(d);
        }
      }
    }
    if (newDays.length > 0) {
      await saveDays([...days, ...newDays]);
      toast.success("ימי מחלה עודכנו");
    }
    setEditing(false);
  }

  return (
    <div className="py-2 border-b border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">ימי מחלה</span>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Pencil size={14} />
            ערוך ימי מחלה
          </button>
        )}
      </div>
      {/* Read-only chips when not editing */}
      {!editing && days.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {days.map((d) => (
            <span
              key={d.id}
              className={cn("inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs", d.date >= today && "font-bold")}
            >
              {new Date(d.date + "T00:00:00").toLocaleDateString("he-IL")}
            </span>
          ))}
        </div>
      )}
      {days.length === 0 && !editing && (
        <p className="text-sm text-muted-foreground">אין ימי מחלה</p>
      )}
      {editing && (
        <div className="space-y-2 mt-1">
          <SickDayRangeEditor
            days={days}
            onDeleteDay={handleDeleteDay}
            ranges={ranges}
            onRangesChange={setRanges}
          />
          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onClick={saveAndClose}
              disabled={ranges.length === 0}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Check size={12} />
              שמור
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
            >
              <X size={12} />
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
