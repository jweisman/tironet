"use client";

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
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
import { TRANSPORTATION_LABELS } from "@/lib/requests/constants";
import type { Transportation } from "@/types";

interface Props {
  request: {
    id: string;
    description: string | null;
    place: string | null;
    departureAt: string | null;
    returnAt: string | null;
    transportation: string | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

/** Format an ISO date string to datetime-local input value. */
function toLocalDatetime(isoStr: string | null): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr; // already in local format
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditLeaveRequestForm({ request, onSuccess, onCancel }: Props) {
  const db = usePowerSync();

  const [description, setDescription] = useState(request.description ?? "");
  const [place, setPlace] = useState(request.place ?? "");
  const [departureAt, setDepartureAt] = useState(toLocalDatetime(request.departureAt));
  const [returnAt, setReturnAt] = useState(toLocalDatetime(request.returnAt));
  const [transportation, setTransportation] = useState(request.transportation ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (departureAt && returnAt && departureAt >= returnAt) {
      setError("שעת היציאה חייבת להיות לפני שעת החזרה");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await db.execute(
        `UPDATE requests SET description = ?, place = ?, departure_at = ?, return_at = ?, transportation = ?, updated_at = ? WHERE id = ?`,
        [
          description.trim() || null,
          place.trim() || null,
          departureAt || null,
          returnAt || null,
          transportation || null,
          new Date().toISOString(),
          request.id,
        ],
      );
      onSuccess();
    } catch {
      setError("שגיאה בעדכון הבקשה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-desc">תיאור</Label>
        <textarea
          id="edit-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="סיבת הבקשה, הערות נוספות"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-place">מקום</Label>
        <Input
          id="edit-place"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="לאן יוצא החייל"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="edit-departure">שעת יציאה</Label>
          <Input
            id="edit-departure"
            type="datetime-local"
            value={departureAt}
            onChange={(e) => setDepartureAt(e.target.value)}
            dir="ltr"
            lang="he"
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="edit-return">שעת חזרה</Label>
          <Input
            id="edit-return"
            type="datetime-local"
            value={returnAt}
            onChange={(e) => setReturnAt(e.target.value)}
            dir="ltr"
            lang="he"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>דרך הגעה</Label>
        <Select value={transportation} onValueChange={(v) => { if (v !== null) setTransportation(v === "__none__" ? "" : v); }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="בחר דרך הגעה">
              {transportation ? TRANSPORTATION_LABELS[transportation as Transportation] : "בחר דרך הגעה"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">ללא</SelectItem>
            {(Object.entries(TRANSPORTATION_LABELS) as [Transportation, string][]).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-row-reverse gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          ביטול
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "שומר..." : "שמור שינויים"}
        </Button>
      </div>
    </form>
  );
}
