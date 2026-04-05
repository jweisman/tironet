/**
 * Converts a dateRange filter value ("week" | "month" | "") to a Date
 * representing the start of the filter window, or undefined for "all".
 */
export function dateRangeToAfterDate(dateRange: string | undefined | null): Date | undefined {
  if (!dateRange) return undefined;
  const now = new Date();
  if (dateRange === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (dateRange === "month") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return undefined;
}
