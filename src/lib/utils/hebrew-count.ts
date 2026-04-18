/**
 * Format a count with a Hebrew noun, handling singular/plural grammar.
 *
 * Hebrew rules:
 * - Singular (1): noun first, then number → "בקשה 1"
 * - Plural (0 or 2+): number first, then noun → "3 בקשות"
 *
 * Usage:
 *   hebrewCount(count, "בקשה", "בקשות")  → "בקשה 1" or "3 בקשות"
 *   hebrewCount(count, "חייל", "חיילים")  → "חייל 1" or "5 חיילים"
 */
export function hebrewCount(
  count: number,
  singular: string,
  plural: string,
): string {
  if (count === 1) return `${singular} ${count}`;
  return `${count} ${plural}`;
}

/**
 * Pick the singular or plural form of a Hebrew label based on count.
 * Unlike `hebrewCount`, this returns only the label — not the number.
 * Useful when the number is rendered separately (e.g. in dashboard stat cards).
 *
 * Usage:
 *   hebrewLabel(1, "דווח", "דווחו")    → "דווח"
 *   hebrewLabel(3, "דווח", "דווחו")    → "דווחו"
 */
export function hebrewLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 1 ? singular : plural;
}
