"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ClipboardList, Clock } from "lucide-react";

const INITIAL_LIMIT = 3;
import { useQuery } from "@powersync/react";
import {
  parseMedicalAppointments,
  formatAppointment,
} from "@/lib/requests/medical-appointments";
import { parseSickDays, formatSickDay } from "@/lib/requests/sick-days";
import {
  REQUEST_TYPE_LABELS,
  REQUEST_TYPE_ICONS,
} from "@/lib/requests/constants";
import { getLeaveOnDate, formatLeaveOnDateLabel } from "@/lib/requests/active";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import type { RequestType } from "@/types";

// ---------------------------------------------------------------------------
// "Active today" filter — matches the daily cron notification logic:
//   Leave:   departureAt <= today AND returnAt >= today (on leave today)
//   Medical: any appointment.date === today
// ---------------------------------------------------------------------------

function isActiveToday(r: RawActiveRequest, today: string): boolean {
  if (r.type === "leave") {
    const dep = r.departure_at?.split("T")[0];
    const ret = r.return_at?.split("T")[0];
    return dep != null && ret != null && dep <= today && ret >= today;
  }
  if (r.type === "medical") {
    const appts = parseMedicalAppointments(r.medical_appointments);
    const days = parseSickDays(r.sick_days);
    return appts.some((a) => a.date.split("T")[0] === today) || days.some((d) => d.date === today);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Query: all approved requests in scope with soldier names
// Params: [cycleId, squadId]
// ---------------------------------------------------------------------------

const ACTIVE_REQUESTS_QUERY = `
  SELECT
    r.id, r.type, r.status,
    r.departure_at, r.return_at, r.medical_appointments, r.sick_days,
    s.family_name || ' ' || s.given_name AS soldier_name,
    sq.name AS squad_name
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  JOIN squads sq ON sq.id = s.squad_id
  WHERE r.cycle_id = ?
    AND r.status = 'approved'
    AND r.type IN ('leave', 'medical')
    AND (
      (SELECT ? AS sq_filter) = '' OR s.squad_id = (SELECT ? AS sq_filter2)
    )
`;

interface RawActiveRequest {
  id: string;
  type: string;
  status: string;
  departure_at: string | null;
  return_at: string | null;
  medical_appointments: string | null;
  sick_days: string | null;
  soldier_name: string;
  squad_name: string;
}

interface ActiveRequest {
  id: string;
  type: RequestType;
  soldierName: string;
  squadName: string;
  detail: string;
  sortKey: string; // timed events sort before all-day events
  imminent: boolean; // time is within the next hour
  past: boolean; // timed event has already passed
}

/** Returns true when the ISO datetime is within the next 60 minutes. */
function isWithinNextHour(iso: string, now: Date): boolean {
  if (!iso.includes("T") || iso.endsWith("T00:00:00.000Z")) return false;
  const t = new Date(iso).getTime();
  const n = now.getTime();
  return t > n && t - n <= 60 * 60 * 1000;
}

/** ISO of the operative timed event today, or null for all-day / mid-leave. */
function operativeTodayIso(r: RawActiveRequest, today: string, now: Date): string | null {
  if (r.type === "leave") {
    const info = getLeaveOnDate(r.departure_at, r.return_at, today, now);
    if (info.iso && info.iso.includes("T") && !info.iso.endsWith("T00:00:00.000Z")) {
      return info.iso;
    }
    return null;
  }
  if (r.type === "medical") {
    const appts = parseMedicalAppointments(r.medical_appointments);
    const todayAppt = appts.find((a) => a.date.split("T")[0] === today);
    if (todayAppt && todayAppt.date.includes("T") && !todayAppt.date.endsWith("T00:00:00.000Z")) {
      return todayAppt.date;
    }
    return null;
  }
  return null;
}

function getTodayDetail(type: string, raw: RawActiveRequest, today: string, now: Date): string | null {
  if (type === "leave") {
    return formatLeaveOnDateLabel(getLeaveOnDate(raw.departure_at, raw.return_at, today, now));
  }
  if (type === "medical") {
    const appts = parseMedicalAppointments(raw.medical_appointments);
    const todayAppt = appts.find((a) => a.date.split("T")[0] === today);
    if (todayAppt) return `תור: ${formatAppointment(todayAppt)}`;
    const days = parseSickDays(raw.sick_days);
    const todayDay = days.find((d) => d.date === today);
    if (todayDay) return `יום מחלה: ${formatSickDay(todayDay)}`;
    return null;
  }
  return null;
}

/** Returns true when the request has a timed event starting within the next hour. */
function isImminentRequest(r: RawActiveRequest, today: string, now: Date): boolean {
  const iso = operativeTodayIso(r, today, now);
  return iso != null && isWithinNextHour(iso, now);
}

/** Returns true when the request's timed event for today has already passed. */
function isPastRequest(r: RawActiveRequest, today: string, now: Date): boolean {
  const iso = operativeTodayIso(r, today, now);
  return iso != null && new Date(iso).getTime() <= now.getTime();
}

/** Sort key: timed events by their time, all-day events (sick days, mid-leave) last. */
function todaySortKey(r: RawActiveRequest, today: string, now: Date): string {
  const iso = operativeTodayIso(r, today, now);
  return iso ?? `${today}T99:99`;
}

interface Props {
  cycleId: string;
  squadId: string; // '' for platoon/company scope
  typeFilter?: string; // e.g. "medical" — restricts to a single request type
}

export function ActiveRequestsCallout({ cycleId, squadId, typeFilter }: Props) {
  const router = useRouter();

  const params = useMemo(
    () => [cycleId, squadId, squadId],
    [cycleId, squadId]
  );
  const { data: raw } = useQuery<RawActiveRequest>(
    ACTIVE_REQUESTS_QUERY,
    params
  );

  const requests: ActiveRequest[] = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    return (raw ?? [])
      .filter((r) => isActiveToday(r, today))
      .filter((r) => !typeFilter || r.type === typeFilter)
      .map((r) => ({
        id: r.id,
        type: r.type as RequestType,
        soldierName: r.soldier_name,
        squadName: r.squad_name,
        detail: getTodayDetail(r.type, r, today, now) ?? "",
        sortKey: todaySortKey(r, today, now),
        imminent: isImminentRequest(r, today, now),
        past: isPastRequest(r, today, now),
      }))
      .sort((a, b) => {
        if (a.past !== b.past) return a.past ? 1 : -1;
        return a.sortKey.localeCompare(b.sortKey);
      });
  }, [raw, typeFilter]);

  const [expanded, setExpanded] = useState(false);

  if (requests.length === 0) return null;

  const hasMore = requests.length > INITIAL_LIMIT;
  const visible = expanded ? requests : requests.slice(0, INITIAL_LIMIT);
  const hiddenCount = requests.length - INITIAL_LIMIT;

  return (
    <div data-tour="home-active-requests" className="space-y-2">
      <div className="flex items-center gap-2">
        <ClipboardList size={14} className="text-muted-foreground" />
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          בקשות פעילות להיום
        </h2>
        <span className="text-xs text-muted-foreground">{requests.length}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {visible.map((r) => {
          const Icon = REQUEST_TYPE_ICONS[r.type];
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => router.push(`/requests/${r.id}`)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-muted/50 active:bg-muted ${r.imminent ? "bg-violet-100 dark:bg-violet-950/30" : ""} ${r.past ? "opacity-50" : ""}`}
            >
              <Icon size={16} className="shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {r.soldierName}
                  <span className="text-muted-foreground font-normal">
                    {" "}· {REQUEST_TYPE_LABELS[r.type]}
                  </span>
                </p>
                {r.detail && (
                  <p className="text-xs text-muted-foreground truncate">
                    {r.detail}
                  </p>
                )}
              </div>
              {r.imminent && (
                <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/50 px-1.5 py-0.5 rounded-full">
                  <Clock size={10} />
                  בקרוב
                </span>
              )}
              <ChevronLeft
                size={12}
                className="shrink-0 text-muted-foreground/40"
              />
            </button>
          );
        })}
      </div>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>עוד {hebrewCount(hiddenCount, "בקשה", "בקשות")}</span>
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}
