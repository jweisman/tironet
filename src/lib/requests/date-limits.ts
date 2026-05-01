/**
 * Date boundary helpers for request form validation.
 *
 * All functions return YYYY-MM-DD or YYYY-MM-DDTHH:MM strings suitable
 * for HTML <input type="date"> / <input type="datetime-local"> min/max attributes.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toDatetimeStr(d: Date): string {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

// ---------------------------------------------------------------------------
// Leave requests
// ---------------------------------------------------------------------------

/** Departure: today → 30 days from now */
export function leaveDepartureLimits() {
  const now = new Date();
  return { min: toDatetimeStr(now), max: toDatetimeStr(addDays(now, 30)) };
}

/** Return: today → 60 days from now (departure + up to 30 days of leave) */
export function leaveReturnLimits() {
  const now = new Date();
  return { min: toDatetimeStr(now), max: toDatetimeStr(addDays(now, 60)) };
}

// ---------------------------------------------------------------------------
// Medical appointments
// ---------------------------------------------------------------------------

/** Appointment date: today → 3 months from now */
export function appointmentDateLimits() {
  const now = new Date();
  return { min: toDatetimeStr(now), max: toDatetimeStr(addMonths(now, 3)) };
}

// ---------------------------------------------------------------------------
// Paramedic checkup
// ---------------------------------------------------------------------------

/** Paramedic date: today → 3 months from now */
export function paramedicDateLimits() {
  const now = new Date();
  return { min: toDateStr(now), max: toDateStr(addMonths(now, 3)) };
}

// ---------------------------------------------------------------------------
// Sick days
// ---------------------------------------------------------------------------

/** Sick day: 30 days ago → 14 days from now */
export function sickDayLimits() {
  const now = new Date();
  return { min: toDateStr(addDays(now, -30)), max: toDateStr(addDays(now, 14)) };
}
