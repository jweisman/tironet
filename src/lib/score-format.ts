/**
 * Format a numeric grade for display based on format type.
 * Time-format grades (stored as seconds) are displayed as M:SS.
 */
export function formatGradeDisplay(value: number | null, format: "number" | "time" = "number"): string {
  if (value == null) return "";
  if (format === "time") {
    const totalSeconds = Math.round(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return String(value);
}

/**
 * Parse a grade input that may be a plain number or a time string (M:SS, MM:SS, or HH:MM:SS).
 * When format is "number", only plain numbers are accepted (colon is rejected).
 * When format is "time", time strings are converted to total seconds; plain numbers are also accepted.
 * When format is omitted, both formats are accepted (backwards-compatible).
 */
export function parseGradeInput(raw: string, format?: "number" | "time"): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // HH:MM:SS — common CSV export format for durations
  const hmsMatch = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hmsMatch) {
    if (format === "number") return null;
    const hours = Number(hmsMatch[1]);
    const minutes = Number(hmsMatch[2]);
    const seconds = Number(hmsMatch[3]);
    if (minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  // M:SS or MM:SS
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    if (format === "number") return null;
    const minutes = Number(timeMatch[1]);
    const seconds = Number(timeMatch[2]);
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  const num = Number(trimmed);
  return isNaN(num) ? null : num;
}

/**
 * Parse a time input that may be a colon-form time string (M:SS, MM:SS, HH:MM:SS)
 * or a digit-only compact form where the last 2 digits are seconds and the rest
 * are minutes (e.g. "43" → 43s, "103" → 1:03 = 63s, "1215" → 12:15 = 735s).
 *
 * Used by the manual report-entry input so users can type with a numeric keypad.
 * Bulk import callers must use parseGradeInput, which keeps treating plain numbers
 * as raw seconds.
 */
export function parseCompactTimeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.includes(":")) return parseGradeInput(trimmed, "time");
  if (!/^\d+$/.test(trimmed)) return null;
  const secondsPart = trimmed.length <= 2 ? trimmed : trimmed.slice(-2);
  const minutesPart = trimmed.length <= 2 ? "0" : trimmed.slice(0, -2);
  const seconds = Number(secondsPart);
  const minutes = Number(minutesPart);
  return minutes * 60 + seconds;
}
