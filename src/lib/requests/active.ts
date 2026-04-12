import { parseMedicalAppointments, hasUpcomingAppointment } from "./medical-appointments";

/**
 * Minimal fields needed to determine if a request is "active" per DEFINITIONS.md:
 * - leave: departure or return date is today or in the future
 * - medical: any appointment date is today or in the future
 * - hardship: always active once approved
 */
interface ActiveCheckFields {
  status: string;
  type: string;
  departureAt?: string | null;
  returnAt?: string | null;
  medicalAppointments?: string | unknown[] | null;
}

/**
 * Returns true if an approved request is currently active.
 * Accepts an optional `today` string (YYYY-MM-DD) for testability;
 * defaults to the current date.
 */
export function isRequestActive(r: ActiveCheckFields, today?: string): boolean {
  if (r.status !== "approved") return false;
  const todayStr = today ?? new Date().toISOString().split("T")[0];

  if (r.type === "hardship") return true;

  if (r.type === "leave") {
    const dep = r.departureAt?.split("T")[0];
    const ret = r.returnAt?.split("T")[0];
    return (dep != null && dep >= todayStr) || (ret != null && ret >= todayStr);
  }

  if (r.type === "medical") {
    const appts = parseMedicalAppointments(r.medicalAppointments);
    return hasUpcomingAppointment(appts);
  }

  return false;
}
