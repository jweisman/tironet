"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePowerSync } from "@powersync/react";
import type { RawHomeVisit } from "./HomeVisitSection";

interface Props {
  soldierId: string;
  userName: string;
  userId: string;
  existing?: RawHomeVisit;
  onSuccess: () => void;
  onCancel: () => void;
}

export function HomeVisitForm({ soldierId, userName, userId, existing, onSuccess, onCancel }: Props) {
  const db = usePowerSync();
  const [date, setDate] = useState(existing?.date?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
  const [status, setStatus] = useState<"in_order" | "deficiencies">(
    (existing?.status as "in_order" | "deficiencies") ?? "in_order",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      setError("יש לבחור תאריך");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (existing) {
        await db.execute(
          "UPDATE home_visits SET date = ?, status = ?, notes = ? WHERE id = ?",
          [date, status, notes.trim() || null, existing.id],
        );
      } else {
        const id = crypto.randomUUID();
        await db.execute(
          `INSERT INTO home_visits (id, soldier_id, date, created_by_name, created_by_user_id, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, soldierId, date, userName, userId, status, notes.trim() || null],
        );
      }
      onSuccess();
    } catch {
      setError("שגיאה בשמירת הביקור");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="visit-date" required>תאריך</Label>
        <Input
          id="visit-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          dir="ltr"
        />
      </div>

      <div className="space-y-1.5">
        <Label>סטטוס</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={status === "in_order" ? "default" : "outline"}
            size="sm"
            className={status === "in_order" ? "bg-green-600 hover:bg-green-700" : ""}
            onClick={() => setStatus("in_order")}
          >
            תקין
          </Button>
          <Button
            type="button"
            variant={status === "deficiencies" ? "default" : "outline"}
            size="sm"
            className={status === "deficiencies" ? "bg-amber-600 hover:bg-amber-700" : ""}
            onClick={() => setStatus("deficiencies")}
          >
            ליקויים
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="visit-notes">הערות</Label>
        <textarea
          id="visit-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="הערות (אופציונלי)"
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-row-reverse gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          ביטול
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "שומר..." : existing ? "שמור שינויים" : "הוסף ביקור"}
        </Button>
      </div>
    </form>
  );
}
