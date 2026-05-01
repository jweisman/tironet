"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MedicalAppointment } from "@/lib/requests/medical-appointments";
import { appointmentDateLimits } from "@/lib/requests/date-limits";

interface Props {
  value: MedicalAppointment[];
  onChange: (appointments: MedicalAppointment[]) => void;
}

/**
 * Controlled appointment list editor. Renders editable cards for each
 * appointment plus an "add" button. Used by both the create form and
 * the detail-page MedicalAppointmentsSection.
 */
export function AppointmentListEditor({ value, onChange }: Props) {
  function add() {
    onChange([...value, { id: crypto.randomUUID(), date: "", place: "", type: "" }]);
  }

  function remove(id: string) {
    onChange(value.filter((a) => a.id !== id));
  }

  function update(id: string, field: keyof Omit<MedicalAppointment, "id">, v: string) {
    onChange(value.map((a) => (a.id === id ? { ...a, [field]: v } : a)));
  }

  return (
    <div className="space-y-2">
      {value.map((appt) => (
        <div key={appt.id} className="rounded-lg border border-border p-2 space-y-1.5">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => remove(appt.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-0.5 min-w-0">
              <Label className="text-xs">תאריך ושעה</Label>
              <Input
                type="datetime-local"
                step={300}
                value={appt.date}
                onChange={(e) => update(appt.id, "date", e.target.value)}
                min={appointmentDateLimits().min}
                max={appointmentDateLimits().max}
                dir="ltr"
                lang="he"
                className="w-full min-w-0"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-xs">מקום</Label>
              <Input
                value={appt.place}
                onChange={(e) => update(appt.id, "place", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs">סוג</Label>
            <Input
              value={appt.type}
              onChange={(e) => update(appt.id, "type", e.target.value)}
              placeholder="לדוגמה: פיזיותרפיה"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors w-full justify-center"
      >
        <Plus size={14} />
        הוסף תור
      </button>
    </div>
  );
}
