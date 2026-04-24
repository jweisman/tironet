"use client";

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Props {
  request: {
    id: string;
    description: string | null;
    paramedicDate: string | null;
    urgent: number | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export function EditMedicalRequestForm({ request, onSuccess, onCancel }: Props) {
  const db = usePowerSync();

  const [description, setDescription] = useState(request.description ?? "");
  const [paramedicDate, setParamedicDate] = useState(request.paramedicDate ?? "");
  const [urgent, setUrgent] = useState(!!request.urgent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await db.execute(
        `UPDATE requests SET description = ?, paramedic_date = ?, urgent = ?, updated_at = ? WHERE id = ?`,
        [
          description.trim() || null,
          paramedicDate || null,
          urgent ? 1 : 0,
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

      <div className="space-y-1.5">
        <Label htmlFor="edit-paramedic">תאריך בדיקת חופ&quot;ל</Label>
        <Input
          id="edit-paramedic"
          type="date"
          value={paramedicDate}
          onChange={(e) => setParamedicDate(e.target.value)}
          dir="ltr"
          lang="he"
          style={paramedicDate ? undefined : { color: "transparent" }}
        />
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
