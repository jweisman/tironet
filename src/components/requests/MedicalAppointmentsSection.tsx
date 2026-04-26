"use client";

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { parseMedicalAppointments, formatAppointment } from "@/lib/requests/medical-appointments";
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

  function startEditing() {
    setEditList(appts.length > 0 ? appts : []);
    setEditing(true);
  }

  async function save() {
    const valid = editList
      .filter((a) => a.date)
      .map((a) => a.date.includes("T") ? { ...a, date: new Date(a.date).toISOString() } : a);
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
