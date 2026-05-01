/**
 * Date boundary validators for request forms.
 *
 * Returns Hebrew error messages for out-of-range dates.
 * Used in form submit handlers — NOT as HTML min/max attributes
 * (browser validation shows English messages and has step conflicts).
 */

const pad = (n: number) => String(n).padStart(2, "0");

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** Validate departure date: not more than 30 days in the past or future. */
export function validateLeaveDeparture(value: string): string | null {
  if (!value) return null;
  const date = value.split("T")[0];
  const now = new Date();
  const min = toDateStr(addDays(now, -30));
  const max = toDateStr(addDays(now, 30));
  if (date < min) return "תאריך יציאה לא יכול להיות יותר מ-30 יום בעבר";
  if (date > max) return "תאריך יציאה לא יכול להיות יותר מ-30 יום מהיום";
  return null;
}

/** Validate return date: not more than 30 days after departure. */
export function validateLeaveReturn(value: string, departureAt?: string): string | null {
  if (!value) return null;
  const date = value.split("T")[0];
  if (departureAt) {
    const depDate = departureAt.split("T")[0];
    const max = toDateStr(addDays(new Date(depDate + "T00:00:00"), 30));
    if (date > max) return "תאריך חזרה לא יכול להיות יותר מ-30 יום אחרי היציאה";
  } else {
    const max = toDateStr(addDays(new Date(), 30));
    if (date > max) return "תאריך חזרה לא יכול להיות יותר מ-30 יום מהיום";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Medical appointments
// ---------------------------------------------------------------------------

/** Validate appointment date: 30 days back to 90 days forward. */
export function validateAppointmentDate(value: string): string | null {
  if (!value) return null;
  const date = value.split("T")[0];
  const now = new Date();
  const min = toDateStr(addDays(now, -30));
  const max = toDateStr(addDays(now, 90));
  if (date < min) return "תאריך תור לא יכול להיות יותר מ-30 יום בעבר";
  if (date > max) return "תאריך תור לא יכול להיות יותר מ-90 יום מהיום";
  return null;
}

// ---------------------------------------------------------------------------
// Paramedic checkup
// ---------------------------------------------------------------------------

/** Validate paramedic date: not more than 30 days in the past or future. */
export function validateParamedicDate(value: string): string | null {
  if (!value) return null;
  const now = new Date();
  const min = toDateStr(addDays(now, -30));
  const max = toDateStr(addDays(now, 30));
  if (value < min) return "תאריך בדיקת חופ״ל לא יכול להיות יותר מ-30 יום בעבר";
  if (value > max) return "תאריך בדיקת חופ״ל לא יכול להיות יותר מ-30 יום מהיום";
  return null;
}

// ---------------------------------------------------------------------------
// Sick days
// ---------------------------------------------------------------------------

/** Validate sick day start: 30 days back to 30 days forward. */
export function validateSickDay(value: string): string | null {
  if (!value) return null;
  const now = new Date();
  const min = toDateStr(addDays(now, -30));
  const max = toDateStr(addDays(now, 30));
  if (value < min) return "יום מחלה לא יכול להיות יותר מ-30 יום בעבר";
  if (value > max) return "יום מחלה לא יכול להיות יותר מ-30 יום מהיום";
  return null;
}

/** Validate sick day end: not more than 30 days after start. */
export function validateSickDayEnd(value: string, startDate: string): string | null {
  if (!value || !startDate) return null;
  const max = toDateStr(addDays(new Date(startDate + "T00:00:00"), 30));
  if (value > max) return "תאריך סיום לא יכול להיות יותר מ-30 יום אחרי ההתחלה";
  return null;
}
