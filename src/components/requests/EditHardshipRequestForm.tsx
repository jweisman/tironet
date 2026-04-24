"use client";

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Props {
  request: {
    id: string;
    description: string | null;
    urgent: number | null;
    specialConditions: number | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export function EditHardshipRequestForm({ request, onSuccess, onCancel }: Props) {
  const db = usePowerSync();

  const [description, setDescription] = useState(request.description ?? "");
  const [urgent, setUrgent] = useState(!!request.urgent);
  const [specialConditions, setSpecialConditions] = useState(!!request.specialConditions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await db.execute(
        `UPDATE requests SET description = ?, urgent = ?, special_conditions = ?, updated_at = ? WHERE id = ?`,
        [
          description.trim() || null,
          urgent ? 1 : 0,
          specialConditions ? 1 : 0,
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

      <div className="flex items-center justify-between">
        <Label htmlFor="edit-urgent">דחוף</Label>
        <Switch id="edit-urgent" checked={urgent} onCheckedChange={setUrgent} />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="edit-special">אוכלוסיות מיוחדות</Label>
        <Switch id="edit-special" checked={specialConditions} onCheckedChange={setSpecialConditions} />
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
