import { parseMedicalAppointments, hasUpcomingAppointment } from "./medical-appointments";

/**
 * Minimal fields needed to determine if a request is "active" per DEFINITIONS.md:
 * - leave: departure or return date is today or in the future
 * - medical: any appointment date is today or in the future
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

/**
 * Returns true if a request is "open" per DEFINITIONS.md:
 * in progress (status === 'open') OR active (approved + meets date criteria).
 */
export function isRequestOpen(r: ActiveCheckFields, today?: string): boolean {
  if (r.status === "open") return true;
  return isRequestActive(r, today);
}

/**
 * Returns true if a request has the "urgent" flag per DEFINITIONS.md:
 * - medical with the `urgent` flag
 * - hardship with the `specialConditions` flag
 *
 * Accepts both boolean (API/Prisma) and number (PowerSync SQLite 0/1).
 * Note: the urgent *indicator* should only show when the request is also open
 * (in progress or active). Use `isRequestOpen(r) && isRequestUrgent(r)`.
 */
export function isRequestUrgent(r: {
  type: string;
  urgent?: boolean | number | null;
  specialConditions?: boolean | number | null;
}): boolean {
  if (r.type === "medical" && (r.urgent === true || r.urgent === 1)) return true;
  if (r.type === "hardship" && ((r.specialConditions === true || r.specialConditions === 1) || (r.urgent === true || r.urgent === 1))) return true;
  return false;
}
