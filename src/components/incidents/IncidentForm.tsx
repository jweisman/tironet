"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePowerSync } from "@powersync/react";
import type { RawIncident } from "./IncidentSection";
import {
  INCIDENT_TYPE_LABELS,
  SUBTYPE_OPTIONS,
  type IncidentType,
} from "@/lib/incidents/constants";

interface Props {
  soldierId: string;
  userName: string;
  userId: string;
  existing?: RawIncident;
  onSuccess: () => void;
  onCancel: () => void;
}

const TYPE_BUTTON_CLASS: Record<IncidentType, string> = {
  commendation: "bg-green-600 hover:bg-green-700",
  discipline: "bg-amber-600 hover:bg-amber-700",
  safety: "bg-red-600 hover:bg-red-700",
};

const DEFAULT_SUBTYPE = "general";

/** Pick a valid subtype for the given type — falls back to 'general' when current is empty or invalid. */
function resolveSubtype(type: IncidentType, current: string | null | undefined): string {
  const options = SUBTYPE_OPTIONS[type] ?? [];
  if (current && options.some((o) => o.value === current)) return current;
  return DEFAULT_SUBTYPE;
}

export function IncidentForm({ soldierId, userName, userId, existing, onSuccess, onCancel }: Props) {
  const db = usePowerSync();
  const initialType = (existing?.type as IncidentType) ?? "commendation";
  const [type, setType] = useState<IncidentType>(initialType);
  const [subtype, setSubtype] = useState(() => resolveSubtype(initialType, existing?.subtype));
  const [date, setDate] = useState(existing?.date?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [response, setResponse] = useState(existing?.response ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtypeOptions = SUBTYPE_OPTIONS[type] ?? [];

  function handleTypeChange(next: IncidentType) {
    if (next === type) return;
    setType(next);
    // Reset subtype to 'general' since old subtype is no longer valid for the new type
    setSubtype(DEFAULT_SUBTYPE);
  }

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
    if (!subtype) {
      setError("יש לבחור תת-סוג");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (existing) {
        await db.execute(
          "UPDATE incidents SET type = ?, subtype = ?, date = ?, description = ?, response = ? WHERE id = ?",
          [type, subtype, date, description.trim(), response.trim() || null, existing.id],
        );
      } else {
        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        await db.execute(
          `INSERT INTO incidents (id, soldier_id, type, subtype, date, created_by_name, created_by_user_id, description, response, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, soldierId, type, subtype, date, userName, userId, description.trim(), response.trim() || null, createdAt],
        );
      }
      onSuccess();
    } catch {
      setError("שגיאה בשמירת האירוע");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>סוג</Label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map((t) => (
            <Button
              key={t}
              type="button"
              variant={type === t ? "default" : "outline"}
              size="sm"
              className={type === t ? TYPE_BUTTON_CLASS[t] : ""}
              onClick={() => handleTypeChange(t)}
            >
              {INCIDENT_TYPE_LABELS[t]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label required>תת-סוג</Label>
        <Select
          value={subtype}
          onValueChange={(v) => v && setSubtype(v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {subtypeOptions.find((o) => o.value === subtype)?.label ?? subtype}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {subtypeOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          placeholder="תיאור האירוע"
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
          {loading ? "שומר..." : existing ? "שמור שינויים" : "הוסף אירוע"}
        </Button>
      </div>
    </form>
  );
}
