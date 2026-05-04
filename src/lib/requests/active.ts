import {
  parseMedicalAppointments,
  hasUpcomingAppointment,
  type MedicalAppointment,
} from "./medical-appointments";
import { parseSickDays, hasUpcomingSickDay } from "./sick-days";

/**
 * Minimal fields needed to determine if a request is "active" per DEFINITIONS.md:
 * - leave: departure or return date is today or in the future
 * - medical: any appointment date or sick day is today or in the future
 */
interface ActiveCheckFields {
  status: string;
  type: string;
  departureAt?: string | null;
  returnAt?: string | null;
  medicalAppointments?: string | unknown[] | null;
  sickDays?: string | unknown[] | null;
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
    const days = parseSickDays(r.sickDays);
    return hasUpcomingAppointment(appts) || hasUpcomingSickDay(days);
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

// ---------------------------------------------------------------------------
// Compact "active on date" formatters — shared by the home page callout and
// the active-requests push notification body.
// ---------------------------------------------------------------------------

export type LeaveOnDateKind = "departure" | "return" | "mid";

export interface LeaveOnDateInfo {
  kind: LeaveOnDateKind;
  iso: string | null;
}

function toIsoString(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : v;
}

function isoHasTime(iso: string): boolean {
  return iso.includes("T") && !iso.endsWith("T00:00:00.000Z");
}

/**
 * Classify a leave request relative to a given date:
 * - "departure" if departureAt falls on dateStr (and hasn't yet passed)
 * - "return" if returnAt falls on dateStr (and departureAt does not, or has passed on a single-day leave)
 * - "mid" otherwise (active but neither boundary is the operative event for the date)
 *
 * Pass `now` so the operative event can shift once the departure time has passed:
 * - Single-day leave (dep + ret both today): once departure passes, swap to "חזרה עד {return}".
 * - Multi-day leave starting today: once departure passes, swap to "ביציאה" — the
 *   soldier is on leave, not still about to leave; the past departure time is no
 *   longer the relevant info today.
 */
export function getLeaveOnDate(
  departureAt: string | Date | null | undefined,
  returnAt: string | Date | null | undefined,
  dateStr: string,
  now?: Date,
): LeaveOnDateInfo {
  const dep = toIsoString(departureAt);
  const ret = toIsoString(returnAt);
  const depOnDate = dep != null && dep.split("T")[0] === dateStr;
  const retOnDate = ret != null && ret.split("T")[0] === dateStr;
  const depPassed =
    depOnDate && now != null && isoHasTime(dep!) && new Date(dep!).getTime() <= now.getTime();

  if (depOnDate && retOnDate) {
    if (depPassed) return { kind: "return", iso: ret! };
    return { kind: "departure", iso: dep! };
  }
  if (depOnDate) {
    if (depPassed) return { kind: "mid", iso: null };
    return { kind: "departure", iso: dep! };
  }
  if (retOnDate) return { kind: "return", iso: ret! };
  return { kind: "mid", iso: null };
}

/**
 * Render the leave detail label as used in the home page callout and the
 * active-requests notification body:
 *   - departure today: "יציאה עד HH:MM"
 *   - return today:    "חזרה עד HH:MM"
 *   - mid-stretch or no time component: "ביציאה"
 *
 * Pass `timeZone: "Asia/Jerusalem"` from server-side callers so notification
 * times match the user's local time regardless of the server timezone.
 */
export function formatLeaveOnDateLabel(
  info: LeaveOnDateInfo,
  options?: { timeZone?: string },
): string {
  if (info.kind === "mid" || !info.iso || !isoHasTime(info.iso)) return "ביציאה";
  const time = new Date(info.iso).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options?.timeZone,
  });
  const verb = info.kind === "departure" ? "יציאה" : "חזרה";
  return `${verb} עד ${time}`;
}

/**
 * Compact medical-appointment label for the notification body:
 * "תור רפואי בשעה HH:MM" when a time is present, otherwise "תור רפואי".
 */
export function formatMedicalApptShortLabel(
  appt: Pick<MedicalAppointment, "date">,
  options?: { timeZone?: string },
): string {
  if (!isoHasTime(appt.date)) return "תור רפואי";
  const time = new Date(appt.date).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options?.timeZone,
  });
  return `תור רפואי בשעה ${time}`;
}

/** Compact sick-day label for the notification body. */
export const SICK_DAY_SHORT_LABEL = "ביום מחלה";
