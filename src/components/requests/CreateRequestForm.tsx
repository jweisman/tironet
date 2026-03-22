"use client";

import { useState, useMemo } from "react";
import { usePowerSync, useQuery } from "@powersync/react";
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
import { TRANSPORTATION_LABELS } from "@/lib/requests/constants";
import type { RequestType, Transportation, Role } from "@/types";

interface Props {
  cycleId: string;
  requestType: RequestType;
  userRole: Role;
  /** Pre-selected soldier ID (when creating from soldier detail page) */
  preselectedSoldierId?: string;
  onSuccess: (requestId: string) => void;
  onCancel: () => void;
}

const SOLDIERS_QUERY = `
  SELECT s.id, s.given_name, s.family_name,
         sq.name AS squad_name
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  WHERE s.cycle_id = ?
    AND s.status = 'active'
  ORDER BY s.family_name, s.given_name
`;

export function CreateRequestForm({
  cycleId,
  requestType,
  userRole,
  preselectedSoldierId,
  onSuccess,
  onCancel,
}: Props) {
  const db = usePowerSync();

  const soldierParams = useMemo(() => [cycleId], [cycleId]);
  const { data: soldiers } = useQuery<{
    id: string;
    given_name: string;
    family_name: string;
    squad_name: string;
  }>(SOLDIERS_QUERY, soldierParams);

  const [soldierId, setSoldierId] = useState(preselectedSoldierId ?? "");
  const [description, setDescription] = useState("");

  // Leave fields
  const [place, setPlace] = useState("");
  const [departureAt, setDepartureAt] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [transportation, setTransportation] = useState<Transportation | "">("");

  // Medical fields
  const [urgent, setUrgent] = useState(false);
  const [paramedicDate, setParamedicDate] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentPlace, setAppointmentPlace] = useState("");
  const [appointmentType, setAppointmentType] = useState("");
  const [sickLeaveDays, setSickLeaveDays] = useState<number | "">("");

  // Hardship fields
  const [specialConditions, setSpecialConditions] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine initial assignment based on creator's role
  const assignedRole: Role =
    userRole === "platoon_commander" ? "company_commander" : "platoon_commander";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!soldierId) {
      setError("יש לבחור חייל");
      return;
    }

    setSubmitting(true);
    setError(null);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      // Write to local PowerSync DB for offline support
      const columns = [
        "id", "cycle_id", "soldier_id", "type", "status", "assigned_role",
        "created_by_user_id", "description", "created_at", "updated_at",
      ];
      const values: unknown[] = [
        id, cycleId, soldierId, requestType, "open", assignedRole,
        "", // created_by_user_id will be set by server on sync
        description || null, now, now,
      ];

      if (requestType === "leave") {
        columns.push("place", "departure_at", "return_at", "transportation");
        values.push(
          place || null,
          departureAt || null,
          returnAt || null,
          transportation || null,
        );
      }

      if (requestType === "medical") {
        columns.push(
          "urgent", "paramedic_date", "appointment_date",
          "appointment_place", "appointment_type", "sick_leave_days",
        );
        values.push(
          urgent ? 1 : 0,
          paramedicDate || null,
          appointmentDate || null,
          appointmentPlace || null,
          appointmentType || null,
          sickLeaveDays === "" ? null : sickLeaveDays,
        );
      }

      if (requestType === "hardship") {
        columns.push("urgent", "special_conditions");
        values.push(urgent ? 1 : 0, specialConditions ? 1 : 0);
      }

      const placeholders = columns.map(() => "?").join(", ");
      await db.execute(
        `INSERT INTO requests (${columns.join(", ")}) VALUES (${placeholders})`,
        values,
      );

      onSuccess(id);
    } catch {
      setError("שגיאה ביצירת הבקשה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Soldier selector */}
      {!preselectedSoldierId && (
        <div className="space-y-1.5">
          <Label>חייל</Label>
          <Select value={soldierId} onValueChange={(v) => { if (v !== null) setSoldierId(v); }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="בחר חייל">
                {soldiers?.find((s) => s.id === soldierId)
                  ? `${soldiers.find((s) => s.id === soldierId)!.family_name} ${soldiers.find((s) => s.id === soldierId)!.given_name}`
                  : "בחר חייל"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(soldiers ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.family_name} {s.given_name} ({s.squad_name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Description (all types) */}
      <div className="space-y-1.5">
        <Label htmlFor="req-desc">תיאור</Label>
        <textarea
          id="req-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="סיבת הבקשה, חשיבות לחייל, הערות נוספות"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          rows={3}
        />
      </div>

      {/* Leave-specific fields */}
      {requestType === "leave" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="req-place">מקום</Label>
            <Input
              id="req-place"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="לאן יוצא החייל"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="req-departure">שעת יציאה</Label>
              <Input
                id="req-departure"
                type="datetime-local"
                value={departureAt}
                onChange={(e) => setDepartureAt(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-return">שעת חזרה</Label>
              <Input
                id="req-return"
                type="datetime-local"
                value={returnAt}
                onChange={(e) => setReturnAt(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>דרך הגעה</Label>
            <Select value={transportation} onValueChange={(v) => { if (v !== null) setTransportation(v as Transportation); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="בחר דרך הגעה">
                  {transportation ? TRANSPORTATION_LABELS[transportation as Transportation] : "בחר דרך הגעה"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
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
        </>
      )}

      {/* Medical-specific fields */}
      {requestType === "medical" && (
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="req-urgent">דחוף</Label>
            <Switch id="req-urgent" checked={urgent} onCheckedChange={setUrgent} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-paramedic">תאריך בדיקת חופ&quot;ל</Label>
            <Input
              id="req-paramedic"
              type="date"
              value={paramedicDate}
              onChange={(e) => setParamedicDate(e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="req-appt-date">תאריך תור</Label>
              <Input
                id="req-appt-date"
                type="date"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-appt-place">מקום התור</Label>
              <Input
                id="req-appt-place"
                value={appointmentPlace}
                onChange={(e) => setAppointmentPlace(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-appt-type">סוג התור</Label>
            <Input
              id="req-appt-type"
              value={appointmentType}
              onChange={(e) => setAppointmentType(e.target.value)}
              placeholder="לדוגמה: פיזיותרפיה"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-sick-days">ימי גימלים</Label>
            <Input
              id="req-sick-days"
              type="number"
              min={0}
              value={sickLeaveDays}
              onChange={(e) =>
                setSickLeaveDays(e.target.value === "" ? "" : Number(e.target.value))
              }
              dir="ltr"
            />
          </div>
        </>
      )}

      {/* Hardship-specific fields */}
      {requestType === "hardship" && (
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="req-urgent-h">דחוף</Label>
            <Switch id="req-urgent-h" checked={urgent} onCheckedChange={setUrgent} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="req-special">אוכלוסיות מיוחדות</Label>
            <Switch
              id="req-special"
              checked={specialConditions}
              onCheckedChange={setSpecialConditions}
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

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
          {submitting ? "יוצר..." : "צור בקשה"}
        </Button>
      </div>
    </form>
  );
}
