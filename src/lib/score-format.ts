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
