"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActivityType {
  id: string;
  name: string;
  icon: string;
}

interface PlatoonOption {
  id: string;
  name: string;
}

interface Props {
  cycleId: string;
  platoonOptions: PlatoonOption[];
  onSuccess: (activityId: string, platoonCount: number) => void;
  onCancel: () => void;
}

export function CreateActivityForm({ cycleId, platoonOptions, onSuccess, onCancel }: Props) {
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  const [activityTypeId, setActivityTypeId] = useState("");
  const [name, setName] = useState("");
  const [nameOverridden, setNameOverridden] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [isRequired, setIsRequired] = useState(true);
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [platoonId, setPlatoonId] = useState(
    platoonOptions.length === 1 ? platoonOptions[0].id : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingTypes(true);
    fetch("/api/activity-types")
      .then((r) => r.json())
      .then((data: ActivityType[]) => setActivityTypes(data))
      .catch(() => setActivityTypes([]))
      .finally(() => setLoadingTypes(false));
  }, []);

  function handleTypeChange(typeId: string) {
    setActivityTypeId(typeId);
    // Auto-fill name from type name only if user hasn't overridden it
    if (!nameOverridden) {
      const type = activityTypes.find((t) => t.id === typeId);
      if (type) setName(type.name);
    }
  }

  function handleNameChange(val: string) {
    setName(val);
    setNameOverridden(val !== "");
  }

  const targetPlatoonIds = platoonId === "__all__"
    ? platoonOptions.map((p) => p.id)
    : [platoonId];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activityTypeId || !name.trim() || !date || !platoonId) {
      setError("יש למלא את כל השדות הנדרשים");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let firstActivityId = "";
      for (const pid of targetPlatoonIds) {
        const res = await fetch("/api/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cycleId,
            platoonId: pid,
            activityTypeId,
            name: name.trim(),
            date,
            isRequired,
            status,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "שגיאה ביצירת הפעילות");
          return;
        }

        const data = await res.json();
        if (!firstActivityId) firstActivityId = data.activity.id;
      }

      onSuccess(firstActivityId, targetPlatoonIds.length);
    } catch {
      setError("שגיאה ביצירת הפעילות");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Platoon selector (only if multiple) */}
      {platoonOptions.length > 1 && (
        <div className="space-y-1.5">
          <Label>מחלקה</Label>
          <Select value={platoonId} onValueChange={(v) => { if (v !== null) setPlatoonId(v); }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="בחר מחלקה">
                {platoonId === "__all__"
                  ? "כל המחלקות"
                  : platoonOptions.find((p) => p.id === platoonId)?.name ?? "בחר מחלקה"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">כל המחלקות</SelectItem>
              {platoonOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Activity type */}
      <div className="space-y-1.5">
        <Label>סוג פעילות</Label>
        {loadingTypes ? (
          <div className="text-sm text-muted-foreground">טוען...</div>
        ) : (
          <Select value={activityTypeId} onValueChange={(v) => { if (v !== null) handleTypeChange(v); }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="בחר סוג">
                {activityTypes.find((t) => t.id === activityTypeId)?.name ?? "בחר סוג"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {activityTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="activity-name">שם הפעילות</Label>
        <Input
          id="activity-name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="שם הפעילות"
        />
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label htmlFor="activity-date">תאריך</Label>
        <Input
          id="activity-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          dir="ltr"
        />
      </div>

      {/* Required */}
      <div className="flex items-center justify-between">
        <Label htmlFor="activity-required">פעילות חובה</Label>
        <Switch
          id="activity-required"
          checked={isRequired}
          onCheckedChange={setIsRequired}
        />
      </div>

      {/* Status */}
      <div className="space-y-1.5">
        <Label>סטטוס</Label>
        <div className="flex rounded-lg bg-muted p-1 gap-1" role="radiogroup" aria-label="סטטוס">
          <button
            type="button"
            role="radio"
            aria-checked={status === "draft"}
            onClick={() => setStatus("draft")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
              status === "draft"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            טיוטה
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={status === "active"}
            onClick={() => setStatus("active")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
              status === "active"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            פעיל
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1"
        >
          ביטול
        </Button>
        <Button type="submit" disabled={submitting} className="flex-1">
          {submitting ? "יוצר..." : "צור פעילות"}
        </Button>
      </div>
    </form>
  );
}
