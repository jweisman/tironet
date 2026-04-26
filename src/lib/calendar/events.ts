import { parseMedicalAppointments } from "@/lib/requests/medical-appointments";
import { parseSickDays } from "@/lib/requests/sick-days";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarEventType = "activity" | "leave" | "medical_appointment" | "sick_day";

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  type: CalendarEventType;
  label: string; // activity name or soldier "familyName givenName"
  platoonId: string;
  platoonName: string;
  /** Icon name from activity type (activities only) */
  icon?: string | null;
  /** Original activity or request UUID — used for linking to detail pages */
  sourceId: string;
}

export interface CalendarData {
  cycleName: string;
  companyName: string | null;
  events: CalendarEvent[];
  platoons: { id: string; name: string }[];
  /** Which event types the user's role can see */
  visibleTypes: CalendarEventType[];
}

// ---------------------------------------------------------------------------
// Platoon color palette
// ---------------------------------------------------------------------------

export interface PlatoonColor {
  bg: string; // Tailwind class
  text: string; // Tailwind class
  border: string; // Tailwind class
  hex: string; // For PDF rendering
  hexBg: string; // Light background for PDF
}

const PLATOON_COLORS: PlatoonColor[] = [
  { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", hex: "#2563eb", hexBg: "#dbeafe" },
  { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300", hex: "#059669", hexBg: "#d1fae5" },
  { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", hex: "#d97706", hexBg: "#fef3c7" },
  { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300", hex: "#7c3aed", hexBg: "#ede9fe" },
  { bg: "bg-rose-100", text: "text-rose-800", border: "border-rose-300", hex: "#e11d48", hexBg: "#ffe4e6" },
  { bg: "bg-cyan-100", text: "text-cyan-800", border: "border-cyan-300", hex: "#0891b2", hexBg: "#cffafe" },
  { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", hex: "#ea580c", hexBg: "#ffedd5" },
  { bg: "bg-indigo-100", text: "text-indigo-800", border: "border-indigo-300", hex: "#4f46e5", hexBg: "#e0e7ff" },
];

/** Event-type colors for single-platoon users (platoon commanders) */
export const EVENT_TYPE_COLORS: Record<CalendarEventType, PlatoonColor> = {
  activity: { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", hex: "#2563eb", hexBg: "#dbeafe" },
  leave: { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", hex: "#d97706", hexBg: "#fef3c7" },
  medical_appointment: { bg: "bg-rose-100", text: "text-rose-800", border: "border-rose-300", hex: "#e11d48", hexBg: "#ffe4e6" },
  sick_day: { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300", hex: "#7c3aed", hexBg: "#ede9fe" },
};

export function getPlatoonColorMap(platoonIds: string[]): Map<string, PlatoonColor> {
  const map = new Map<string, PlatoonColor>();
  platoonIds.forEach((id, i) => {
    map.set(id, PLATOON_COLORS[i % PLATOON_COLORS.length]);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Event type labels & icons
// ---------------------------------------------------------------------------

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  activity: "פעילויות",
  leave: "יציאות",
  medical_appointment: "תורים רפואיים",
  sick_day: "ימי מחלה",
};

// ---------------------------------------------------------------------------
// Filter categories — groups event types for the toolbar
// ---------------------------------------------------------------------------

export type CalendarFilterCategory = "activity" | "leave" | "medical";

export const FILTER_CATEGORY_LABELS: Record<CalendarFilterCategory, string> = {
  activity: "פעילויות",
  leave: "יציאות",
  medical: "רפואה",
};

/** Map a filter category to the event types it controls */
export const FILTER_TO_EVENT_TYPES: Record<CalendarFilterCategory, CalendarEventType[]> = {
  activity: ["activity"],
  leave: ["leave"],
  medical: ["medical_appointment", "sick_day"],
};

/** Derive filter categories from visible event types */
export function visibleTypesToFilters(visibleTypes: CalendarEventType[]): CalendarFilterCategory[] {
  const filters: CalendarFilterCategory[] = [];
  if (visibleTypes.includes("activity")) filters.push("activity");
  if (visibleTypes.includes("leave")) filters.push("leave");
  if (visibleTypes.includes("medical_appointment") || visibleTypes.includes("sick_day")) {
    filters.push("medical");
  }
  return filters;
}

/** Expand enabled filter categories to the set of event types to show */
export function filtersToEventTypes(enabledFilters: Set<CalendarFilterCategory>): Set<CalendarEventType> {
  const types = new Set<CalendarEventType>();
  for (const filter of enabledFilters) {
    for (const type of FILTER_TO_EVENT_TYPES[filter]) {
      types.add(type);
    }
  }
  return types;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Get the 3-month window: first day of current month to last day of month+2 */
export function getThreeMonthRange(baseDate?: string): { startDate: string; endDate: string; months: { year: number; month: number }[] } {
  const base = baseDate ? new Date(baseDate + "T12:00:00") : new Date();
  const year = base.getFullYear();
  const month = base.getMonth(); // 0-indexed

  const months: { year: number; month: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const m = month + i;
    months.push({ year: year + Math.floor(m / 12), month: m % 12 });
  }

  const startDate = `${months[0].year}-${String(months[0].month + 1).padStart(2, "0")}-01`;
  const lastMonth = months[2];
  const lastDay = new Date(lastMonth.year, lastMonth.month + 1, 0).getDate();
  const endDate = `${lastMonth.year}-${String(lastMonth.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return { startDate, endDate, months };
}

// ---------------------------------------------------------------------------
// Leave date expansion
// ---------------------------------------------------------------------------

/**
 * Expand a leave request's departure/return range into individual dates.
 */
export function expandLeaveDates(departureAt: string, returnAt: string): string[] {
  const startStr = departureAt.split("T")[0];
  const endStr = returnAt.split("T")[0];
  const dates: string[] = [];
  const current = new Date(startStr + "T12:00:00Z");
  const end = new Date(endStr + "T12:00:00Z");

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Build events from raw data (shared by API and PDF renderer)
// ---------------------------------------------------------------------------

export interface RawActivity {
  id: string;
  name: string;
  date: string;
  platoonId: string;
  platoonName: string;
  activityTypeIcon: string | null;
}

export interface RawRequest {
  id: string;
  type: string; // "leave" | "medical"
  status: string;
  departureAt: string | null;
  returnAt: string | null;
  medicalAppointments: unknown;
  sickDays: unknown;
  soldierName: string;
  platoonId: string;
  platoonName: string;
}

export function buildCalendarEvents(
  activities: RawActivity[],
  requests: RawRequest[],
  startDate: string,
  endDate: string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  // Activities
  for (const a of activities) {
    if (a.date >= startDate && a.date <= endDate) {
      events.push({
        id: `activity-${a.id}`,
        date: a.date,
        type: "activity",
        label: a.name,
        platoonId: a.platoonId,
        platoonName: a.platoonName,
        icon: a.activityTypeIcon,
        sourceId: a.id,
      });
    }
  }

  // Leave requests
  for (const r of requests) {
    if (r.type === "leave" && r.status === "approved" && r.departureAt && r.returnAt) {
      const dates = expandLeaveDates(r.departureAt, r.returnAt);
      for (const date of dates) {
        if (date >= startDate && date <= endDate) {
          events.push({
            id: `leave-${r.id}-${date}`,
            date,
            type: "leave",
            label: r.soldierName,
            platoonId: r.platoonId,
            platoonName: r.platoonName,
            sourceId: r.id,
          });
        }
      }
    }

    // Medical appointments
    if (r.type === "medical") {
      const appointments = parseMedicalAppointments(r.medicalAppointments as string | null);
      for (const appt of appointments) {
        const apptDate = appt.date.split("T")[0];
        if (apptDate >= startDate && apptDate <= endDate) {
          events.push({
            id: `appt-${r.id}-${appt.id}`,
            date: apptDate,
            type: "medical_appointment",
            label: r.soldierName,
            platoonId: r.platoonId,
            platoonName: r.platoonName,
            sourceId: r.id,
          });
        }
      }

      // Sick days
      const sickDays = parseSickDays(r.sickDays as string | null);
      for (const sd of sickDays) {
        if (sd.date >= startDate && sd.date <= endDate) {
          events.push({
            id: `sick-${r.id}-${sd.id}`,
            date: sd.date,
            type: "sick_day",
            label: r.soldierName,
            platoonId: r.platoonId,
            platoonName: r.platoonName,
            sourceId: r.id,
          });
        }
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Event detail link
// ---------------------------------------------------------------------------

export function getEventHref(event: CalendarEvent): string {
  return event.type === "activity"
    ? `/activities/${event.sourceId}`
    : `/requests/${event.sourceId}`;
}

// ---------------------------------------------------------------------------
// Month bounds from events
// ---------------------------------------------------------------------------

/** Returns the min and max { year, month } across all events. Falls back to current month. */
export function getMonthBounds(events: CalendarEvent[]): {
  min: { year: number; month: number };
  max: { year: number; month: number };
} {
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() };
  if (events.length === 0) return { min: current, max: current };

  let minY = Infinity, minM = Infinity, maxY = -Infinity, maxM = -Infinity;
  for (const e of events) {
    const [y, m] = e.date.split("-").map(Number);
    const ym = y * 12 + (m - 1);
    if (ym < minY * 12 + minM) { minY = y; minM = m - 1; }
    if (ym > maxY * 12 + maxM) { maxY = y; maxM = m - 1; }
  }

  // Include current month in range
  const curYM = current.year * 12 + current.month;
  if (curYM < minY * 12 + minM) { minY = current.year; minM = current.month; }
  if (curYM > maxY * 12 + maxM) { maxY = current.year; maxM = current.month; }

  return {
    min: { year: minY, month: minM },
    max: { year: maxY, month: maxM },
  };
}

// ---------------------------------------------------------------------------
// Group events by date
// ---------------------------------------------------------------------------

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = map.get(event.date);
    if (list) {
      list.push(event);
    } else {
      map.set(event.date, [event]);
    }
  }
  return map;
}
