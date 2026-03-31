/**
 * Parse a grade input that may be a plain number or a time string (M:SS / MM:SS).
 * Returns the numeric value (seconds for time strings), or null for empty/invalid input.
 */
export function parseGradeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Time format: M:SS or MM:SS
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const minutes = Number(timeMatch[1]);
    const seconds = Number(timeMatch[2]);
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  const num = Number(trimmed);
  return isNaN(num) ? null : num;
}
