"use client";

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { parseMedicalAppointments, formatAppointment } from "@/lib/requests/medical-appointments";
import { validateAppointmentDate } from "@/lib/requests/date-limits";
import type { MedicalAppointment } from "@/lib/requests/medical-appointments";
import { AppointmentListEditor } from "./AppointmentListEditor";

interface Props {
  requestId: string;
  medicalAppointmentsJson: string | null;
  canEdit: boolean;
}

export function MedicalAppointmentsSection({ requestId, medicalAppointmentsJson, canEdit }: Props) {
  const db = usePowerSync();
  const appts = parseMedicalAppointments(medicalAppointmentsJson);

  const [editing, setEditing] = useState(false);
  const [editList, setEditList] = useState<MedicalAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setEditList(
      appts.length > 0
        ? appts.map((a) => {
            if (!a.date.includes("T")) return a;
            // Convert ISO string (UTC) to datetime-local format (local time)
            const d = new Date(a.date);
            const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            return { ...a, date: local };
          })
        : [],
    );
    setEditing(true);
  }

  async function save() {
    const valid = editList
      .filter((a) => a.date)
      .map((a) => a.date.includes("T") ? { ...a, date: new Date(a.date).toISOString() } : a);
    for (const a of editList) {
      const validationErr = validateAppointmentDate(a.date);
      if (validationErr) { setError(validationErr); return; }
    }
    setError(null);
    try {
      await db.execute(
        `UPDATE requests SET medical_appointments = ?, updated_at = ? WHERE id = ?`,
        [valid.length > 0 ? JSON.stringify(valid) : null, new Date().toISOString(), requestId],
      );
      toast.success("תורים עודכנו");
      setEditing(false);
    } catch {
      toast.error("שגיאה בעדכון תורים");
    }
  }

  return (
    <div className="py-2 border-b border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">תורים</span>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Pencil size={14} />
            ערוך תורים
          </button>
        )}
      </div>
      {!editing ? (
        appts.length > 0 ? (
          <ul className="space-y-1">
            {appts.map((a) => (
              <li key={a.id} className="text-sm font-medium">
                {formatAppointment(a)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">אין תורים</p>
        )
      ) : (
        <div className="space-y-2 mt-2">
          <AppointmentListEditor value={editList} onChange={setEditList} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onClick={save}
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
