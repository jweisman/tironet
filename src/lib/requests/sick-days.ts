export interface SickDay {
  id: string;
  date: string; // YYYY-MM-DD
}

/**
 * Parse a JSON string (from SQLite text column or Prisma JSON field)
 * into a typed array of sick days.
 */
export function parseSickDays(
  json: string | unknown[] | null | undefined,
): SickDay[] {
  if (!json) return [];
  try {
    const arr = typeof json === "string" ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (item): item is SickDay =>
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

/** Returns true if any sick day has a date >= today. */
export function hasUpcomingSickDay(days: SickDay[]): boolean {
  const today = new Date().toISOString().split("T")[0];
  return days.some((d) => d.date >= today);
}

/** Format a single sick day for display: DD/MM/YYYY */
export function formatSickDay(d: SickDay): string {
  const date = new Date(d.date + "T00:00:00");
  return date.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/**
 * Expand a date range into individual SickDay entries.
 * If `to` is null/undefined, returns a single day.
 */
export function expandSickDayRange(from: string, to?: string | null): SickDay[] {
  const days: SickDay[] = [];
  const start = new Date(from + "T12:00:00Z");
  const end = to ? new Date(to + "T12:00:00Z") : start;

  const current = new Date(start);
  while (current <= end) {
    days.push({
      id: crypto.randomUUID(),
      date: current.toISOString().split("T")[0],
    });
    current.setDate(current.getDate() + 1);
  }
  return days;
}
