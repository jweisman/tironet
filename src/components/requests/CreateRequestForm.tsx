"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
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
import { Trash2, Plus } from "lucide-react";
import { TRANSPORTATION_LABELS } from "@/lib/requests/constants";
import type { MedicalAppointment } from "@/lib/requests/medical-appointments";
import { expandSickDayRange } from "@/lib/requests/sick-days";
import type { SickDay } from "@/lib/requests/sick-days";
import type { RequestType, Transportation, Role } from "@/types";

/** Format a Date as a `datetime-local` input value (YYYY-MM-DDTHH:MM). */
function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  cycleId: string;
  requestType: RequestType;
  userRole: Role;
  /** Unit ID from the user's cycle assignment (squad/platoon/company ID) */
  unitId: string;
  /** Pre-selected soldier ID (when creating from soldier detail page) */
  preselectedSoldierId?: string;
  onSuccess: (requestId: string) => void;
  onCancel: () => void;
}

// Squad commanders: only their squad's soldiers
const SOLDIERS_BY_SQUAD_QUERY = `
  SELECT s.id, s.given_name, s.family_name,
         sq.name AS squad_name
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  WHERE s.cycle_id = ?
    AND s.squad_id = ?
    AND s.status = 'active'
  ORDER BY s.family_name, s.given_name
`;

// Platoon commanders: all soldiers in their platoon's squads
const SOLDIERS_BY_PLATOON_QUERY = `
  SELECT s.id, s.given_name, s.family_name,
         sq.name AS squad_name
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  WHERE s.cycle_id = ?
    AND sq.platoon_id = ?
    AND s.status = 'active'
  ORDER BY s.family_name, s.given_name
`;

// Company-level roles (medic): squads in the company (for squad selector)
const SQUADS_BY_COMPANY_QUERY = `
  SELECT sq.id, sq.name AS squad_name, p.name AS platoon_name
  FROM squads sq
  JOIN platoons p ON p.id = sq.platoon_id
  WHERE p.company_id = ?
  ORDER BY p.sort_order, p.name, sq.sort_order, sq.name
`;

// Soldiers in a specific squad (used after medic selects a squad)
const SOLDIERS_BY_SQUAD_ID_QUERY = `
  SELECT s.id, s.given_name, s.family_name,
         sq.name AS squad_name
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  WHERE s.cycle_id = ?
    AND s.squad_id = ?
    AND s.status = 'active'
  ORDER BY s.family_name, s.given_name
`;

export function CreateRequestForm({
  cycleId,
  requestType,
  userRole,
  unitId,
  preselectedSoldierId,
  onSuccess,
  onCancel,
}: Props) {
  const db = usePowerSync();
  const { data: session } = useSession();

  const isSquadRole = userRole === "squad_commander";
  const isCompanyRole = userRole === "company_medic" || userRole === "hardship_coordinator";

  // For company-level roles (medic): load squads for the squad selector
  const squadsParams = useMemo(() => [unitId], [unitId]);
  const { data: companySquads } = useQuery<{
    id: string;
    squad_name: string;
    platoon_name: string;
  }>(isCompanyRole ? SQUADS_BY_COMPANY_QUERY : "SELECT 1 WHERE 0", isCompanyRole ? squadsParams : []);

  const [selectedSquadId, setSelectedSquadId] = useState("");

  // Soldier query: medics query by selected squad, others by their unit
  const soldierQuery = isCompanyRole
    ? SOLDIERS_BY_SQUAD_ID_QUERY
    : isSquadRole
      ? SOLDIERS_BY_SQUAD_QUERY
      : SOLDIERS_BY_PLATOON_QUERY;
  const soldierParams = useMemo(
    () => isCompanyRole ? [cycleId, selectedSquadId] : [cycleId, unitId],
    [cycleId, unitId, selectedSquadId, isCompanyRole],
  );
  const { data: soldiers } = useQuery<{
    id: string;
    given_name: string;
    family_name: string;
    squad_name: string;
  }>(soldierQuery, soldierParams);

  const [soldierId, setSoldierId] = useState(preselectedSoldierId ?? "");
  const [description, setDescription] = useState("");

  // Leave fields
  const [place, setPlace] = useState("");
  // Default departure: next whole hour; return: departure + 24h
  const [departureAt, setDepartureAt] = useState(() => {
    if (requestType !== "leave") return "";
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return toLocalDatetime(d);
  });
  const [returnAt, setReturnAt] = useState(() => {
    if (requestType !== "leave") return "";
    const d = new Date();
    d.setHours(d.getHours() + 25, 0, 0, 0);
    return toLocalDatetime(d);
  });
  const [transportation, setTransportation] = useState<Transportation | "">("");

  // Medical fields
  const [urgent, setUrgent] = useState(false);
  const [paramedicDate, setParamedicDate] = useState("");
  const [appointments, setAppointments] = useState<MedicalAppointment[]>([]);
  const [sickDays, setSickDays] = useState<SickDay[]>([]);
  const [sickDayFrom, setSickDayFrom] = useState("");
  const [sickDayTo, setSickDayTo] = useState("");

  function addAppointment() {
    setAppointments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), date: "", place: "", type: "" },
    ]);
  }

  function updateAppointment(id: string, field: keyof Omit<MedicalAppointment, "id">, value: string) {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)),
    );
  }

  function removeAppointment(id: string) {
    setAppointments((prev) => prev.filter((a) => a.id !== id));
  }

  // Hardship fields
  const [specialConditions, setSpecialConditions] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine initial assignment based on creator's role
  // Platoon commander skips to company; platoon sergeant and squad commander go to platoon commander
  const assignedRole: Role =
    userRole === "platoon_commander" ? "company_commander" : "platoon_commander";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!soldierId) {
      setError("יש לבחור חייל");
      return;
    }

    if (requestType === "leave" && departureAt && returnAt && departureAt >= returnAt) {
      setError("שעת היציאה חייבת להיות לפני שעת החזרה");
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
          "urgent", "paramedic_date", "medical_appointments", "sick_days",
        );
        const validAppointments = appointments.filter((a) => a.date);
        values.push(
          urgent ? 1 : 0,
          paramedicDate || null,
          validAppointments.length > 0 ? JSON.stringify(validAppointments) : null,
          sickDays.length > 0 ? JSON.stringify(sickDays) : null,
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

      // Insert audit trail entry for the "create" action
      const user = session?.user as { id?: string; familyName?: string; givenName?: string } | undefined;
      const actionUserName = user
        ? `${user.familyName ?? ""} ${user.givenName ?? ""}`.trim()
        : "";
      await db.execute(
        `INSERT INTO request_actions (id, request_id, user_id, action, note, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), id, user?.id ?? "", "create", null, actionUserName, now],
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
      {/* Squad selector (medic only) */}
      {isCompanyRole && !preselectedSoldierId && (
        <div className="space-y-1.5">
          <Label required>כיתה</Label>
          <Select value={selectedSquadId} onValueChange={(v) => { if (v !== null) { setSelectedSquadId(v); setSoldierId(""); } }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="בחר כיתה">
                {companySquads?.find((sq) => sq.id === selectedSquadId)
                  ? `${companySquads.find((sq) => sq.id === selectedSquadId)!.platoon_name} - ${companySquads.find((sq) => sq.id === selectedSquadId)!.squad_name}`
                  : "בחר כיתה"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(companySquads ?? []).map((sq) => (
                <SelectItem key={sq.id} value={sq.id}>
                  {sq.platoon_name} - {sq.squad_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Soldier selector */}
      {!preselectedSoldierId && (!isCompanyRole || selectedSquadId) && (
        <div className="space-y-1.5">
          <Label required>חייל</Label>
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
                  {s.family_name} {s.given_name}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="req-departure">שעת יציאה</Label>
              <Input
                id="req-departure"
                type="datetime-local"
                value={departureAt}
                onChange={(e) => setDepartureAt(e.target.value)}
                dir="ltr"
                lang="he"
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
                lang="he"
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
              lang="he"
              style={paramedicDate ? undefined : { color: "transparent" }}
            />
          </div>

          {/* Appointments list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>תורים</Label>
              <button
                type="button"
                onClick={addAppointment}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
              >
                <Plus size={14} />
                הוסף תור
              </button>
            </div>
            {appointments.length === 0 && (
              <p className="text-xs text-muted-foreground">אין תורים. לחץ &quot;הוסף תור&quot; כדי להוסיף.</p>
            )}
            {appointments.map((appt) => (
              <div key={appt.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">תור</span>
                  <button
                    type="button"
                    onClick={() => removeAppointment(appt.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">תאריך ושעה</Label>
                    <Input
                      type="datetime-local"
                      value={appt.date}
                      onChange={(e) => updateAppointment(appt.id, "date", e.target.value)}
                      dir="ltr"
                      lang="he"
                      style={appt.date ? undefined : { color: "transparent" }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">מקום</Label>
                    <Input
                      value={appt.place}
                      onChange={(e) => updateAppointment(appt.id, "place", e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">סוג</Label>
                  <Input
                    value={appt.type}
                    onChange={(e) => updateAppointment(appt.id, "type", e.target.value)}
                    placeholder="לדוגמה: פיזיותרפיה"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>ימי מחלה</Label>
            {sickDays.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sickDays.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    {new Date(d.date + "T00:00:00").toLocaleDateString("he-IL")}
                    <button
                      type="button"
                      onClick={() => setSickDays((prev) => prev.filter((s) => s.id !== d.id))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-xs">מתאריך</Label>
                <Input
                  type="date"
                  value={sickDayFrom}
                  onChange={(e) => setSickDayFrom(e.target.value)}
                  dir="ltr"
                  lang="he"
                  style={sickDayFrom ? undefined : { color: "transparent" }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">עד תאריך</Label>
                <Input
                  type="date"
                  value={sickDayTo}
                  onChange={(e) => setSickDayTo(e.target.value)}
                  min={sickDayFrom || undefined}
                  dir="ltr"
                  lang="he"
                  style={sickDayTo ? undefined : { color: "transparent" }}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={!sickDayFrom}
              onClick={() => {
                const newDays = expandSickDayRange(sickDayFrom, sickDayTo || null);
                // Filter out duplicates
                setSickDays((prev) => {
                  const existing = new Set(prev.map((d) => d.date));
                  return [...prev, ...newDays.filter((d) => !existing.has(d.date))];
                });
                setSickDayFrom("");
                setSickDayTo("");
              }}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors w-full justify-center disabled:opacity-50"
            >
              <Plus size={14} />
              הוסף ימי מחלה
            </button>
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

      <div className="flex flex-row-reverse gap-2 pt-2">
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
