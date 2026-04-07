// ---------------------------------------------------------------------------
// Shared types and rendering for the 3-column request detail layout.
// Used by both server-side HTML reports and client-side React pages.
// ---------------------------------------------------------------------------

import type { MedicalAppointment } from "@/lib/requests/medical-appointments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pre-computed data for the 3-column detail layout. */
export interface DetailColumnsData {
  fields: { label: string; value: string }[];
  appointments: string[];
  notes: { label: string; value: string }[];
}

/** Common request fields needed for extraction. */
export interface RequestDetailInput {
  type: string;
  description: string | null;
  place: string | null;
  departureAt: string | null;
  returnAt: string | null;
  transportation: string | null;
  paramedicDate: string | null;
  medicalAppointments: MedicalAppointment[] | null;
  sickLeaveDays: number | null;
  specialConditions: boolean | null;
}

/** Formatters injected by the caller (server escapes HTML, client doesn't). */
export interface DetailFormatters {
  text: (s: string) => string;
  dateTime: (s: string) => string;
  date: (s: string) => string;
  appointment: (a: MedicalAppointment) => string;
  transportationLabels: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Field extraction (shared between server + client)
// ---------------------------------------------------------------------------

export function extractRequestFields(
  req: RequestDetailInput,
  fmt: DetailFormatters,
): { fields: { label: string; value: string }[]; appointments: string[] } {
  const fields: { label: string; value: string }[] = [];
  const appointments: string[] = [];

  if (req.description) {
    fields.push({ label: "תיאור", value: fmt.text(req.description) });
  }

  if (req.type === "leave") {
    if (req.place) fields.push({ label: "מקום", value: fmt.text(req.place) });
    if (req.departureAt) fields.push({ label: "יציאה", value: fmt.dateTime(req.departureAt) });
    if (req.returnAt) fields.push({ label: "חזרה", value: fmt.dateTime(req.returnAt) });
    if (req.transportation) {
      fields.push({
        label: "הגעה",
        value: fmt.transportationLabels[req.transportation] ?? req.transportation,
      });
    }
  }

  if (req.type === "medical") {
    if (req.paramedicDate) fields.push({ label: 'בדיקת חופ"ל', value: fmt.date(req.paramedicDate) });
    if (req.medicalAppointments && req.medicalAppointments.length > 0) {
      for (const appt of req.medicalAppointments) {
        appointments.push(fmt.text(fmt.appointment(appt)));
      }
    }
    if (req.sickLeaveDays != null) fields.push({ label: "ימי גימלים", value: String(req.sickLeaveDays) });
  }

  if (req.type === "hardship") {
    if (req.specialConditions != null) {
      fields.push({ label: "אוכלוסיות מיוחדות", value: req.specialConditions ? "כן" : "לא" });
    }
  }

  return { fields, appointments };
}

// ---------------------------------------------------------------------------
// Note formatting (shared between server + client)
// ---------------------------------------------------------------------------

export interface RequestNote {
  action: string;
  userName: string;
  note: string;
}

const ACTION_LABELS: Record<string, string> = {
  approve: "אישור",
  deny: "דחיה",
  note: "הערה",
};

export function formatNotes(
  notes: RequestNote[],
  escapeText: (s: string) => string = (s) => s,
): { label: string; value: string }[] {
  return notes.map((n) => {
    const actionLabel = ACTION_LABELS[n.action] ?? n.action;
    return { label: `${escapeText(n.userName)} (${actionLabel})`, value: escapeText(n.note) };
  });
}

// ---------------------------------------------------------------------------
// Server-side HTML rendering
// ---------------------------------------------------------------------------

export function renderDetailColumnsHtml(data: DetailColumnsData): string {
  if (data.fields.length === 0 && data.appointments.length === 0 && data.notes.length === 0) return "";

  const columns: string[] = [];

  if (data.fields.length > 0) {
    const fieldRows = data.fields
      .map((f) => `<tr><td class="detail-label">${f.label}</td><td>${f.value}</td></tr>`)
      .join("");
    columns.push(`<table class="detail-grid">${fieldRows}</table>`);
  }

  if (data.appointments.length > 0) {
    const items = data.appointments.map((a) => `<li>${a}</li>`).join("");
    columns.push(`<div class="detail-appointments"><span class="detail-label">תורים</span><ul>${items}</ul></div>`);
  }

  if (data.notes.length > 0) {
    const noteRows = data.notes
      .map((n) => `<p class="detail-note"><span class="detail-label">${n.label}:</span> ${n.value}</p>`)
      .join("");
    columns.push(`<div class="detail-notes">${noteRows}</div>`);
  }

  return `<div class="detail-columns">${columns.join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Shared CSS for the detail-columns layout (embed in <style> blocks)
// ---------------------------------------------------------------------------

export const DETAIL_COLUMNS_CSS = `    .detail-columns {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
      align-items: flex-start;
    }
    .detail-grid {
      border-collapse: collapse;
      width: auto;
      max-width: 60%;
    }
    .detail-grid td {
      padding: 1px 0;
      vertical-align: top;
      word-break: break-word;
    }
    .detail-grid td:first-child {
      padding-left: 8px;
      white-space: nowrap;
      color: #666;
    }
    .detail-label { font-weight: 600; }
    .detail-appointments {
      flex-shrink: 0;
    }
    .detail-appointments ul {
      margin: 1px 8px 0 0;
      padding: 0;
      list-style: none;
    }
    .detail-appointments li {
      white-space: nowrap;
    }
    .detail-appointments li::before {
      content: "–";
      margin-left: 4px;
      color: #999;
    }
    .detail-notes {
      border-right: 1px solid #ddd;
      padding-right: 12px;
      flex: 1;
      min-width: 120px;
    }
    .detail-note {
      color: #888;
      margin-top: 1px;
    }`;
