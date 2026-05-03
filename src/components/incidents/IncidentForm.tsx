"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePowerSync } from "@powersync/react";
import type { RawIncident } from "./IncidentSection";

interface Props {
  soldierId: string;
  userName: string;
  userId: string;
  existing?: RawIncident;
  onSuccess: () => void;
  onCancel: () => void;
}

export function IncidentForm({ soldierId, userName, userId, existing, onSuccess, onCancel }: Props) {
  const db = usePowerSync();
  const [type, setType] = useState<"commendation" | "infraction">(
    (existing?.type as "commendation" | "infraction") ?? "commendation",
  );
  const [date, setDate] = useState(existing?.date?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [response, setResponse] = useState(existing?.response ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError("יש למלא תיאור");
      return;
    }
    if (!date) {
      setError("יש לבחור תאריך");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (existing) {
        await db.execute(
          "UPDATE incidents SET type = ?, date = ?, description = ?, response = ? WHERE id = ?",
          [type, date, description.trim(), response.trim() || null, existing.id],
        );
      } else {
        const id = crypto.randomUUID();
        await db.execute(
          `INSERT INTO incidents (id, soldier_id, type, date, created_by_name, created_by_user_id, description, response)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, soldierId, type, date, userName, userId, description.trim(), response.trim() || null],
        );
      }
      onSuccess();
    } catch {
      setError("שגיאה בשמירת הציון");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>סוג</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === "commendation" ? "default" : "outline"}
            size="sm"
            className={type === "commendation" ? "bg-green-600 hover:bg-green-700" : ""}
            onClick={() => setType("commendation")}
          >
            ציון לשבח
          </Button>
          <Button
            type="button"
            variant={type === "infraction" ? "default" : "outline"}
            size="sm"
            className={type === "infraction" ? "bg-amber-600 hover:bg-amber-700" : ""}
            onClick={() => setType("infraction")}
          >
            ציון התנהגות
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-date" required>תאריך</Label>
        <Input
          id="incident-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          dir="ltr"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-desc" required>תיאור</Label>
        <textarea
          id="incident-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="תיאור הציון"
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-response">תגובה</Label>
        <textarea
          id="incident-response"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="תגובה (אופציונלי)"
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-row-reverse gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          ביטול
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "שומר..." : existing ? "שמור שינויים" : "הוסף ציון"}
        </Button>
      </div>
    </form>
  );
}
