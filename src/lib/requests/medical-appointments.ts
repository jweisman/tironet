export interface MedicalAppointment {
  id: string;
  date: string; // YYYY-MM-DD or YYYY-MM-DDTHH:MM (with time)
  place: string;
  type: string;
}

/**
 * Parse a JSON string (from SQLite text column or Prisma JSON field)
 * into a typed array of medical appointments.
 */
export function parseMedicalAppointments(
  json: string | unknown[] | null | undefined,
): MedicalAppointment[] {
  if (!json) return [];
  try {
    const arr = typeof json === "string" ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (item): item is MedicalAppointment =>
          item != null &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.date === "string",
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/** Returns true if any appointment has a date >= today. */
export function hasUpcomingAppointment(appointments: MedicalAppointment[]): boolean {
  const today = new Date().toISOString().split("T")[0];
  return appointments.some((a) => a.date >= today);
}

/** Format a single appointment for display: סוג / תאריך [שעה] / מקום */
export function formatAppointment(a: MedicalAppointment): string {
  const hasTime = a.date.includes("T");
  const d = new Date(hasTime ? a.date : a.date + "T00:00:00");
  let dateStr = d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
  if (hasTime) {
    dateStr += ` ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const parts = [a.type, dateStr, a.place].filter(Boolean);
  return parts.join(" / ");
}
