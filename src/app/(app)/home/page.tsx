"use client";

import { useMemo, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, WifiOff, LayoutDashboard } from "lucide-react";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
import { useRequestBadge } from "@/hooks/useRequestBadge";
import { useSyncReady } from "@/hooks/useSyncReady";
import { SquadSummaryCard } from "@/components/dashboard/SquadSummaryCard";
import { PlatoonSummaryCard } from "@/components/dashboard/PlatoonSummaryCard";
import type { VisibleSections } from "@/components/dashboard/PlatoonSummaryCard";
import { TodayActivities } from "@/components/dashboard/TodayActivities";
import { ActiveRequestsCallout } from "@/components/dashboard/ActiveRequestsCallout";
import { CommanderEventsCallout } from "@/components/dashboard/CommanderEventsCallout";
import { RecentIncidentsCallout } from "@/components/dashboard/RecentIncidentsCallout";
import { BirthdayCallout } from "@/components/dashboard/BirthdayCallout";
import type { SquadSummary } from "@/app/api/dashboard/route";
import { effectiveRole, ROLE_LABELS } from "@/lib/auth/permissions";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { homeTourSteps } from "@/lib/tour/steps";
import { isRequestActive } from "@/lib/requests/active";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import type { Role } from "@/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_SHORT: Record<string, string> = {
  squad_commander: 'מ"כ',
  platoon_commander: 'מ"מ',
  platoon_sergeant: 'סמ"ח',
  company_commander: 'מ"פ',
  deputy_company_commander: 'סמ"פ',
  instructor: "מדריך",
  company_medic: 'חופ"ל',
  hardship_coordinator: 'מש"קית ת"ש',
};

// ---------------------------------------------------------------------------
// AggregateRow component
// ---------------------------------------------------------------------------

function AggregateRow({ squads }: { squads: SquadSummary[] }) {
  const total = squads.reduce(
    (acc, s) => ({
      soldiers: acc.soldiers + s.soldierCount,
      withGaps: acc.withGaps + s.soldiersWithGaps,
      reported: acc.reported + s.reportedActivities,
      missing: acc.missing + s.missingReportActivities,
      approved: acc.approved + s.approvedRequests,
      inProgress: acc.inProgress + s.inProgressRequests,
    }),
    { soldiers: 0, withGaps: 0, reported: 0, missing: 0, approved: 0, inProgress: 0 }
  );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs flex-wrap">
      <span className="text-muted-foreground">{hebrewCount(total.soldiers, "חייל", "חיילים")}</span>
      {total.withGaps > 0 && (
        <span className="text-amber-600 font-semibold">{total.withGaps} עם פערים</span>
      )}
      {total.inProgress > 0 && (
        <span className="text-amber-600 font-semibold">{hebrewCount(total.inProgress, "בקשה ממתינה", "בקשות ממתינות")}</span>
      )}
      <span className="text-muted-foreground ms-auto">
        <span className="text-green-600 font-semibold">✓ {total.reported}</span>
        {" · "}
        <span className={total.missing > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
          ⚠ {total.missing}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

// Params: [cycleId, squadId]
// squadId: the squad's ID to scope to one squad, or '' for all squads.
const SQUADS_QUERY = `
  WITH
    cycle AS (SELECT ? AS id),
    sf    AS (SELECT ? AS squad_id),
    scope AS (
      SELECT sq2.id AS squad_id
      FROM squads sq2
      JOIN platoons p2 ON p2.id = sq2.platoon_id
      JOIN companies c  ON c.id  = p2.company_id
      WHERE c.cycle_id = (SELECT id FROM cycle)
        AND ((SELECT squad_id FROM sf) = '' OR sq2.id = (SELECT squad_id FROM sf))
    )
  SELECT
    sq.id   AS squad_id,
    sq.name AS squad_name,
    p.id    AS platoon_id,
    p.name  AS platoon_name,
    c.name  AS company_name,
    c.logo  AS company_logo,
    p.logo  AS platoon_logo
  FROM squads sq
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE sq.id IN (SELECT squad_id FROM scope)
  ORDER BY p.sort_order ASC, p.name ASC, sq.sort_order ASC, sq.name ASC
`;

// Active soldier count per squad. Params: [cycleId, squadId, squadId]
const SQUAD_SOLDIER_COUNTS_QUERY = `
  SELECT s.squad_id, COUNT(*) AS soldier_count
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE s.status = 'active'
    AND c.cycle_id = ?
    AND (? = '' OR s.squad_id = ?)
  GROUP BY s.squad_id
`;

// Soldiers with gaps per squad: soldiers who have at least one required past
// activity with a missing, skipped, or failed report.
// Params: [cycleId, squadId, squadId]
const SOLDIERS_WITH_GAPS_QUERY = `
  SELECT s.squad_id, COUNT(DISTINCT s.id) AS soldiers_with_gaps
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  JOIN activities a ON a.platoon_id = sq.platoon_id
    AND a.cycle_id = c.cycle_id
    AND a.status = 'active' AND a.is_required = 1
    AND a.date < DATE('now')
  LEFT JOIN activity_reports ar ON ar.activity_id = a.id AND ar.soldier_id = s.id
  WHERE s.status = 'active'
    AND c.cycle_id = ?
    AND (? = '' OR s.squad_id = ?)
    AND (ar.id IS NULL OR ar.result = 'skipped' OR ar.failed = 1)
  GROUP BY s.squad_id
`;

// Per-squad activity report completeness: for each (squad, activity), count
// soldiers who are missing a report. An activity is "reported" if missing = 0,
// "missing" if missing > 0.
// Params: [cycleId, squadId, squadId]
const ACTIVITY_COMPLETENESS_QUERY = `
  SELECT
    s.squad_id,
    a.id AS activity_id,
    SUM(CASE WHEN ar.id IS NULL THEN 1 ELSE 0 END) AS missing_count
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  JOIN activities a ON a.platoon_id = sq.platoon_id
    AND a.cycle_id = c.cycle_id
    AND a.status = 'active' AND a.is_required = 1
    AND a.date < DATE('now')
  LEFT JOIN activity_reports ar ON ar.activity_id = a.id AND ar.soldier_id = s.id
  WHERE s.status = 'active'
    AND c.cycle_id = ?
    AND (? = '' OR s.squad_id = ?)
  GROUP BY s.squad_id, a.id
`;

// Gap counts per (squad, activity) — replaces correlated subquery in TOP_GAPS_QUERY.
// Counts soldiers with missing, skipped, or failed reports per activity.
// Params: [cycleId, squadId, squadId]
const GAP_COUNTS_QUERY = `
  SELECT
    s.squad_id,
    a.id AS activity_id,
    a.name AS activity_name,
    COUNT(*) AS gap_count
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  JOIN activities a ON a.platoon_id = sq.platoon_id
    AND a.cycle_id = c.cycle_id
    AND a.status = 'active' AND a.is_required = 1
    AND a.date < DATE('now')
  LEFT JOIN activity_reports ar ON ar.activity_id = a.id AND ar.soldier_id = s.id
  WHERE s.status = 'active'
    AND c.cycle_id = ?
    AND (? = '' OR s.squad_id = ?)
    AND (ar.id IS NULL OR ar.result = 'skipped' OR ar.failed = 1)
  GROUP BY s.squad_id, a.id
  HAVING gap_count > 0
  ORDER BY s.squad_id, gap_count DESC
`;

// Per-squad request rows — fetched individually so we can apply isRequestActive()
// client-side (single source of truth for "active" logic).
// Params: [cycleId, squadId]
const REQUESTS_QUERY = `
  WITH
    cycle AS (SELECT ? AS id),
    sf    AS (SELECT ? AS squad_id),
    scope AS (
      SELECT sq2.id AS squad_id
      FROM squads sq2
      JOIN platoons p2 ON p2.id = sq2.platoon_id
      JOIN companies c  ON c.id  = p2.company_id
      WHERE c.cycle_id = (SELECT id FROM cycle)
        AND ((SELECT squad_id FROM sf) = '' OR sq2.id = (SELECT squad_id FROM sf))
    )
  SELECT
    s.squad_id,
    r.status,
    r.type,
    r.departure_at,
    r.return_at,
    r.medical_appointments
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  WHERE r.cycle_id = (SELECT id FROM cycle)
    AND s.squad_id IN (SELECT squad_id FROM scope)
`;

interface RawSquad {
  squad_id: string; squad_name: string;
  platoon_id: string; platoon_name: string;
  company_name: string; company_logo: string | null; platoon_logo: string | null;
}
interface RawSquadSoldierCount {
  squad_id: string; soldier_count: number;
}
interface RawSoldiersWithGaps {
  squad_id: string; soldiers_with_gaps: number;
}
interface RawActivityCompleteness {
  squad_id: string; activity_id: string; missing_count: number;
}
interface RawGapCount {
  squad_id: string; activity_id: string; activity_name: string; gap_count: number;
}
interface RawSquadRequest {
  squad_id: string;
  status: string;
  type: string;
  departure_at: string | null;
  return_at: string | null;
  medical_appointments: string | null;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HomePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { selectedCycleId, selectedAssignment, activeCycles, isLoading: cycleLoading } = useCycle();
  const requestBadge = useRequestBadge();

  // Check for pending invitations when user has no cycle assignments
  const [pendingInvites, setPendingInvites] = useState<{ id: string; inviteUrl: string; role: string; cycleName: string }[]>([]);
  useEffect(() => {
    if (!cycleLoading && activeCycles.length === 0) {
      fetch("/api/invitations/pending")
        .then((r) => r.json())
        .then((data) => setPendingInvites(data.invitations ?? []))
        .catch(() => {});
    }
  }, [cycleLoading, activeCycles.length]);

  // Determine loading vs "no data" state using PowerSync's hasSynced signal.
  // useQuery returns cached local SQLite data instantly for returning users;
  // the hook only gates the empty-state message until sync confirms emptiness.

  const rawRole = selectedAssignment?.role ?? "";
  const role = rawRole ? effectiveRole(rawRole as Role) : "";
  const squadId = role === "squad_commander" ? (selectedAssignment?.unitId ?? "") : "";

  const cycleId = selectedCycleId ?? "";
  const queryParams = useMemo(
    () => [cycleId, squadId],
    [cycleId, squadId]
  );
  const countsParams = useMemo(
    () => [cycleId, squadId, squadId],
    [cycleId, squadId]
  );

  const { data: rawSquads, isLoading: squadsLoading } = useQuery<RawSquad>(SQUADS_QUERY, queryParams);
  const { data: rawSoldierCounts } = useQuery<RawSquadSoldierCount>(SQUAD_SOLDIER_COUNTS_QUERY, countsParams);
  const { data: rawSoldiersWithGaps } = useQuery<RawSoldiersWithGaps>(SOLDIERS_WITH_GAPS_QUERY, countsParams);
  const { data: rawActivityCompleteness } = useQuery<RawActivityCompleteness>(ACTIVITY_COMPLETENESS_QUERY, countsParams);
  const { data: rawGapCounts } = useQuery<RawGapCount>(GAP_COUNTS_QUERY, countsParams);
  const { data: rawSquadRequests } = useQuery<RawSquadRequest>(REQUESTS_QUERY, queryParams);

  const { showLoading, showEmpty, showConnectionError } = useSyncReady(
    (rawSquads ?? []).length > 0,
    squadsLoading,
    { page: "home", selectedCycleId, role: rawRole || "none", cycleLoading }
  );

  // Build top-3-gaps map per squad from flat rows
  const topGapsMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; gapCount: number }[]>();
    for (const row of rawGapCounts ?? []) {
      if (!map.has(row.squad_id)) map.set(row.squad_id, []);
      const list = map.get(row.squad_id)!;
      if (list.length < 3) {
        list.push({ id: row.activity_id, name: row.activity_name, gapCount: Number(row.gap_count) });
      }
    }
    return map;
  }, [rawGapCounts]);

  // Build request counts map per squad — apply isRequestActive() client-side
  const requestsMap = useMemo(() => {
    const map = new Map<string, { approved: number; inProgress: number }>();
    for (const row of rawSquadRequests ?? []) {
      if (!map.has(row.squad_id)) map.set(row.squad_id, { approved: 0, inProgress: 0 });
      const entry = map.get(row.squad_id)!;
      if (row.status === "open") {
        entry.inProgress++;
      } else if (
        isRequestActive({
          status: row.status,
          type: row.type,
          departureAt: row.departure_at,
          returnAt: row.return_at,
          medicalAppointments: row.medical_appointments,
        })
      ) {
        entry.approved++;
      }
    }
    return map;
  }, [rawSquadRequests]);

  // Build activity completeness maps per squad
  const { reportedMap, missingMap } = useMemo(() => {
    const reported = new Map<string, number>();
    const missing = new Map<string, number>();
    for (const row of rawActivityCompleteness ?? []) {
      const m = Number(row.missing_count);
      if (m === 0) {
        reported.set(row.squad_id, (reported.get(row.squad_id) ?? 0) + 1);
      } else {
        missing.set(row.squad_id, (missing.get(row.squad_id) ?? 0) + 1);
      }
    }
    return { reportedMap: reported, missingMap: missing };
  }, [rawActivityCompleteness]);

  // Build soldier counts and gaps maps
  const soldierCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rawSoldierCounts ?? []) map.set(row.squad_id, Number(row.soldier_count));
    return map;
  }, [rawSoldierCounts]);

  const soldiersWithGapsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rawSoldiersWithGaps ?? []) map.set(row.squad_id, Number(row.soldiers_with_gaps));
    return map;
  }, [rawSoldiersWithGaps]);

  const squads: SquadSummary[] = useMemo(
    () =>
      (rawSquads ?? []).map((raw) => ({
        squadId: raw.squad_id,
        squadName: raw.squad_name,
        platoonId: raw.platoon_id,
        platoonName: raw.platoon_name,
        commanders: [], // UserCycleAssignment is not synced to local SQLite
        soldierCount: soldierCountMap.get(raw.squad_id) ?? 0,
        soldiersWithGaps: soldiersWithGapsMap.get(raw.squad_id) ?? 0,
        reportedActivities: reportedMap.get(raw.squad_id) ?? 0,
        missingReportActivities: missingMap.get(raw.squad_id) ?? 0,
        approvedRequests: requestsMap.get(raw.squad_id)?.approved ?? 0,
        inProgressRequests: requestsMap.get(raw.squad_id)?.inProgress ?? 0,
        topGapActivities: topGapsMap.get(raw.squad_id) ?? [],
      })),
    [rawSquads, soldierCountMap, soldiersWithGapsMap, reportedMap, missingMap, topGapsMap, requestsMap]
  );

  // Build unit path: company > platoon > squad (depending on role)
  const unitPath = useMemo(() => {
    const first = rawSquads?.[0];
    if (!first) return "";
    const parts: string[] = [];
    if (first.company_name) parts.push(first.company_name);
    if (role === "platoon_commander" || role === "squad_commander") {
      if (first.platoon_name) parts.push(first.platoon_name);
    }
    if (role === "squad_commander") {
      if (first.squad_name) parts.push(first.squad_name);
    }
    return parts.join(" > ");
  }, [role, rawSquads]);

  // Platoon logo overrides company logo for platoon-level roles and below.
  // Cached in sessionStorage to avoid flicker from default logo on reload.
  const logo = useMemo(() => {
    const cacheKey = selectedAssignment ? `tironet:logo:${selectedAssignment.cycleId}:${selectedAssignment.unitId}` : null;
    const first = rawSquads?.[0];
    if (first) {
      const resolved = (role === "squad_commander" || role === "platoon_commander")
        ? (first.platoon_logo ?? first.company_logo)
        : first.company_logo;
      if (resolved && cacheKey) {
        try { sessionStorage.setItem(cacheKey, resolved); } catch { /* quota */ }
      }
      return resolved;
    }
    // Data not loaded yet — use cached value to prevent flicker
    if (cacheKey) {
      try { return sessionStorage.getItem(cacheKey); } catch { /* private browsing */ }
    }
    return null;
  }, [rawSquads, role, selectedAssignment]);

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "home", steps: homeTourSteps, ready: !showLoading && squads.length > 0 });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  // Role-based section visibility (#99)
  const cardSections: VisibleSections | undefined = useMemo(() => {
    if (rawRole === "instructor") return { soldiers: true, activities: true, requests: false, gaps: true };
    if (rawRole === "company_medic" || rawRole === "hardship_coordinator") return { soldiers: false, activities: false, requests: true, gaps: false };
    return undefined; // all visible
  }, [rawRole]);

  // While session / cycle context is still resolving, show nothing
  // (avoids flashing "no access" or "choose a cycle" before data arrives).
  if (cycleLoading) {
    return null;
  }

  // No active cycles
  if (activeCycles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין לך גישה למחזור פעיל</p>
        {pendingInvites.length > 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">נמצאו הזמנות ממתינות:</p>
            {pendingInvites.map((inv) => (
              <Link
                key={inv.id}
                href={inv.inviteUrl}
                className="block rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                {inv.cycleName} — {ROLE_LABELS[inv.role as Role] ?? inv.role}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">פנה למפקד שלך כדי לקבל הזמנה.</p>
        )}
      </div>
    );
  }

  const user = session?.user;
  const cycleName = selectedAssignment?.cycleName ?? "";

  // Group squads by platoon for company commander view
  const platoonMap = new Map<string, { platoonId: string; platoonName: string; squads: SquadSummary[] }>();
  for (const s of squads) {
    if (!platoonMap.has(s.platoonId)) {
      platoonMap.set(s.platoonId, { platoonId: s.platoonId, platoonName: s.platoonName, squads: [] });
    }
    platoonMap.get(s.platoonId)!.squads.push(s);
  }
  const platoons = Array.from(platoonMap.values());

  const isCompany = role === "company_commander" || rawRole === "instructor" || rawRole === "company_medic" || rawRole === "hardship_coordinator";
  const isPlatoon = role === "platoon_commander";

  return (
    <div className="space-y-5">
      {/* User context header */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 md:h-16 w-auto max-w-24 items-center justify-center rounded-lg bg-muted p-1.5 shrink-0">
          <img
            src={logo ?? "/images/idf-logo.png"}
            alt=""
            className="h-full w-auto object-contain"
          />
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {user?.rank ? `${user.rank} ` : ""}
            {user?.givenName ?? ""}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {rawRole && (
              <span className="text-sm font-medium text-primary">
                {ROLE_SHORT[rawRole] ?? rawRole}
              </span>
            )}
            {rawRole && (unitPath || cycleName) && (
              <span className="text-muted-foreground text-sm">·</span>
            )}
            {(unitPath || cycleName) && (
              <span className="text-sm text-muted-foreground">{unitPath || cycleName}</span>
            )}
          </div>
        </div>
      </div>

      {/* Requests requiring attention callout */}
      {requestBadge > 0 && rawRole !== "instructor" && (
        <button
          data-tour="home-request-callout"
          type="button"
          onClick={() => router.push("/requests?filter=mine")}
          className="w-full flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 text-start transition-colors hover:bg-amber-50 active:bg-amber-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 shrink-0">
            <Bell size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{requestBadge === 1 ? "בקשה 1 ממתינה לטיפולך" : `${requestBadge} בקשות ממתינות לטיפולך`}</p>
            <p className="text-xs text-muted-foreground">לחץ כדי לצפות</p>
          </div>
        </button>
      )}

      {/* Birthday callout */}
      {selectedCycleId && rawRole !== "company_medic" && rawRole !== "hardship_coordinator" && (
        <BirthdayCallout cycleId={selectedCycleId} squadId={squadId} />
      )}

      {/* Active requests callout (#108) — not for instructor or hardship coordinator */}
      {selectedCycleId && rawRole !== "instructor" && rawRole !== "hardship_coordinator" && (
        <ActiveRequestsCallout cycleId={selectedCycleId} squadId={squadId} typeFilter={rawRole === "company_medic" ? "medical" : undefined} />
      )}

      {/* Commander events callout (#170) — platoon and company commanders only */}
      {selectedCycleId && (role === "platoon_commander" || role === "company_commander") && (
        <CommanderEventsCallout cycleId={selectedCycleId} />
      )}

      {/* Recent incidents callout (#205) — soldier-managing roles only */}
      {selectedCycleId && rawRole !== "instructor" && rawRole !== "company_medic" && rawRole !== "hardship_coordinator" && (
        <RecentIncidentsCallout cycleId={selectedCycleId} squadId={squadId} />
      )}

      {/* Today's activities — not for medic, coordinator, or instructor */}
      {selectedCycleId && rawRole !== "company_medic" && rawRole !== "hardship_coordinator" && rawRole !== "instructor" && (
        <TodayActivities
          cycleId={selectedCycleId}
          squadId={squadId}
          showPlatoon={isCompany}
        />
      )}

      {/* No cycle selected */}
      {!selectedCycleId && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
          <p className="text-lg font-medium">בחר מחזור</p>
          <p className="text-muted-foreground text-sm">בחר מחזור פעיל כדי לצפות בלוח הבקרה.</p>
        </div>
      )}

      {selectedCycleId && squads.length > 0 && (
        <div className="flex items-center gap-2">
          <LayoutDashboard size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            מצב היחידה
          </h2>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {selectedCycleId && (
        <>
          {/* Squad commander — single card */}
          {role === "squad_commander" && squads.length > 0 && (
            <SquadSummaryCard squad={squads[0]} dataTour="home-squad-card" />
          )}

          {/* Platoon commander — aggregate + one card per squad */}
          {isPlatoon && (
            <div className="space-y-3">
              {squads.length > 1 && <div data-tour="home-aggregate"><AggregateRow squads={squads} /></div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {squads.map((s, i) => (
                  <SquadSummaryCard key={s.squadId} squad={s} dataTour={i === 0 ? "home-squad-card" : undefined} />
                ))}
              </div>
            </div>
          )}

          {/* Company level — platoon summary cards (#105, #99) */}
          {isCompany && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {platoons.map((platoon, i) => (
                <PlatoonSummaryCard
                  key={platoon.platoonId}
                  platoonName={platoon.platoonName}
                  squads={platoon.squads}
                  sections={cardSections}
                  dataTour={i === 0 ? "home-platoon-card" : undefined}
                />
              ))}
            </div>
          )}

          {squads.length === 0 && showLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">טוען נתונים...</p>
            </div>
          )}

          {squads.length === 0 && showConnectionError && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
              <p className="font-medium">לא ניתן לטעון נתונים</p>
              <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
            </div>
          )}

          {squads.length === 0 && showEmpty && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <p className="font-medium">אין נתונים להצגה</p>
              <p className="text-sm text-muted-foreground">אין כיתות מוגדרות למחזור זה.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
