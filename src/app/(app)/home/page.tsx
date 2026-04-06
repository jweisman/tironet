"use client";

import { useMemo, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
import { useRequestBadge } from "@/hooks/useRequestBadge";
import { SquadSummaryCard } from "@/components/dashboard/SquadSummaryCard";
import type { SquadSummary } from "@/app/api/dashboard/route";
import { effectiveRole, ROLE_LABELS } from "@/lib/auth/permissions";
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
      <span className="text-muted-foreground">{total.soldiers} חיילים</span>
      {total.withGaps > 0 && (
        <span className="text-amber-600 font-semibold">{total.withGaps} עם פערים</span>
      )}
      {total.inProgress > 0 && (
        <span className="text-amber-600 font-semibold">{total.inProgress} בקשות בטיפול</span>
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

    (SELECT COUNT(*)
     FROM soldiers s
     WHERE s.squad_id = sq.id AND s.status = 'active'
       AND s.cycle_id = (SELECT id FROM cycle)
    ) AS soldier_count,

    (SELECT COUNT(DISTINCT s.id)
     FROM soldiers s
     WHERE s.squad_id = sq.id AND s.status = 'active'
       AND s.cycle_id = (SELECT id FROM cycle)
       AND EXISTS (
         SELECT 1 FROM activities a
         WHERE a.platoon_id = sq.platoon_id
           AND a.cycle_id = (SELECT id FROM cycle)
           AND a.status = 'active' AND a.is_required = 1
           AND a.date < DATE('now')
           AND (
             NOT EXISTS (SELECT 1 FROM activity_reports ar
                         WHERE ar.activity_id = a.id AND ar.soldier_id = s.id)
             OR EXISTS  (SELECT 1 FROM activity_reports ar
                         WHERE ar.activity_id = a.id AND ar.soldier_id = s.id
                           AND ar.result = 'failed')
           )
       )
    ) AS soldiers_with_gaps,

    (SELECT COUNT(*)
     FROM activities a
     WHERE a.platoon_id = sq.platoon_id
       AND a.cycle_id = (SELECT id FROM cycle)
       AND a.status = 'active' AND a.is_required = 1
       AND a.date < DATE('now')
       AND NOT EXISTS (
         SELECT 1 FROM soldiers s
         WHERE s.squad_id = sq.id AND s.status = 'active'
           AND s.cycle_id = (SELECT id FROM cycle)
           AND NOT EXISTS (SELECT 1 FROM activity_reports ar
                           WHERE ar.activity_id = a.id AND ar.soldier_id = s.id)
       )
    ) AS reported_activities,

    (SELECT COUNT(*)
     FROM activities a
     WHERE a.platoon_id = sq.platoon_id
       AND a.cycle_id = (SELECT id FROM cycle)
       AND a.status = 'active' AND a.is_required = 1
       AND a.date < DATE('now')
       AND EXISTS (
         SELECT 1 FROM soldiers s
         WHERE s.squad_id = sq.id AND s.status = 'active'
           AND s.cycle_id = (SELECT id FROM cycle)
           AND NOT EXISTS (SELECT 1 FROM activity_reports ar
                           WHERE ar.activity_id = a.id AND ar.soldier_id = s.id)
       )
    ) AS missing_report_activities

  FROM squads sq
  JOIN platoons p ON p.id = sq.platoon_id
  WHERE sq.id IN (SELECT squad_id FROM scope)
  ORDER BY p.sort_order ASC, p.name ASC, sq.sort_order ASC, sq.name ASC
`;

// Returns one row per (squad, activity) gap — avoids json_group_array.
// JS groups these into topGapActivities (top 3 per squad) after the query.
// Params: [cycleId, squadId]
const TOP_GAPS_QUERY = `
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
  SELECT g.squad_id, g.activity_id, g.activity_name, g.gap_count
  FROM (
    SELECT
      sq.id   AS squad_id,
      a.id    AS activity_id,
      a.name  AS activity_name,
      (SELECT COUNT(*)
       FROM soldiers s
       WHERE s.squad_id = sq.id AND s.status = 'active'
         AND s.cycle_id = (SELECT id FROM cycle)
         AND (
           NOT EXISTS (SELECT 1 FROM activity_reports ar
                       WHERE ar.activity_id = a.id AND ar.soldier_id = s.id)
           OR EXISTS  (SELECT 1 FROM activity_reports ar
                       WHERE ar.activity_id = a.id AND ar.soldier_id = s.id
                         AND ar.result = 'failed')
         )
      ) AS gap_count
    FROM squads sq
    JOIN activities a ON a.platoon_id = sq.platoon_id
      AND a.status = 'active' AND a.is_required = 1
      AND a.cycle_id = (SELECT id FROM cycle)
      AND a.date < DATE('now')
    WHERE sq.id IN (SELECT squad_id FROM scope)
  ) g
  WHERE g.gap_count > 0
  ORDER BY g.squad_id, g.gap_count DESC
`;

// Per-squad request counts — separate query to keep the main SQUADS_QUERY simpler
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
    SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved_requests,
    SUM(CASE WHEN r.assigned_role IS NOT NULL AND r.status != 'approved' THEN 1 ELSE 0 END) AS in_progress_requests
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  WHERE r.cycle_id = (SELECT id FROM cycle)
    AND s.squad_id IN (SELECT squad_id FROM scope)
  GROUP BY s.squad_id
`;

interface RawSquad {
  squad_id: string; squad_name: string;
  platoon_id: string; platoon_name: string;
  soldier_count: number; soldiers_with_gaps: number;
  reported_activities: number; missing_report_activities: number;
}
interface RawSquadRequests {
  squad_id: string;
  approved_requests: number;
  in_progress_requests: number;
}
interface RawTopGap {
  squad_id: string; activity_id: string; activity_name: string; gap_count: number;
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
  const [pendingInvites, setPendingInvites] = useState<{ token: string; role: string; cycleName: string }[]>([]);
  useEffect(() => {
    if (!cycleLoading && activeCycles.length === 0) {
      fetch("/api/invitations/pending")
        .then((r) => r.json())
        .then((data) => setPendingInvites(data.invitations ?? []))
        .catch(() => {});
    }
  }, [cycleLoading, activeCycles.length]);

  // Grace period before showing "no data" — useQuery returns cached local
  // SQLite data almost instantly for returning users, but on first load
  // there is a brief window before PowerSync hydrates. Extended to 3s as
  // a hard upper bound; if data arrives earlier, we render immediately.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const rawRole = selectedAssignment?.role ?? "";
  const role = rawRole ? effectiveRole(rawRole as Role) : "";
  const squadId = role === "squad_commander" ? (selectedAssignment?.unitId ?? "") : "";

  const queryParams = useMemo(
    () => [selectedCycleId ?? "", squadId],
    [selectedCycleId, squadId]
  );

  const { data: rawSquads } = useQuery<RawSquad>(SQUADS_QUERY, queryParams);
  const { data: rawTopGaps } = useQuery<RawTopGap>(TOP_GAPS_QUERY, queryParams);
  const { data: rawSquadRequests } = useQuery<RawSquadRequests>(REQUESTS_QUERY, queryParams);

  // Build top-3-gaps map per squad from flat rows (avoids json_group_array)
  const topGapsMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; gapCount: number }[]>();
    for (const row of rawTopGaps ?? []) {
      if (!map.has(row.squad_id)) map.set(row.squad_id, []);
      const list = map.get(row.squad_id)!;
      if (list.length < 3) {
        list.push({ id: row.activity_id, name: row.activity_name, gapCount: Number(row.gap_count) });
      }
    }
    return map;
  }, [rawTopGaps]);

  // Build request counts map per squad
  const requestsMap = useMemo(() => {
    const map = new Map<string, { approved: number; inProgress: number }>();
    for (const row of rawSquadRequests ?? []) {
      map.set(row.squad_id, {
        approved: Number(row.approved_requests ?? 0),
        inProgress: Number(row.in_progress_requests ?? 0),
      });
    }
    return map;
  }, [rawSquadRequests]);

  const squads: SquadSummary[] = useMemo(
    () =>
      (rawSquads ?? []).map((raw) => ({
        squadId: raw.squad_id,
        squadName: raw.squad_name,
        platoonId: raw.platoon_id,
        platoonName: raw.platoon_name,
        commanders: [], // UserCycleAssignment is not synced to local SQLite
        soldierCount: Number(raw.soldier_count),
        soldiersWithGaps: Number(raw.soldiers_with_gaps),
        reportedActivities: Number(raw.reported_activities),
        missingReportActivities: Number(raw.missing_report_activities),
        approvedRequests: requestsMap.get(raw.squad_id)?.approved ?? 0,
        inProgressRequests: requestsMap.get(raw.squad_id)?.inProgress ?? 0,
        topGapActivities: topGapsMap.get(raw.squad_id) ?? [],
      })),
    [rawSquads, topGapsMap, requestsMap]
  );

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
                key={inv.token}
                href={`/invite/${inv.token}`}
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

  const isCompany = role === "company_commander" || rawRole === "instructor" || rawRole === "company_medic";
  const isPlatoon = role === "platoon_commander";

  return (
    <div className="space-y-5">
      {/* User context header */}
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
          {role && cycleName && (
            <span className="text-muted-foreground text-sm">·</span>
          )}
          {cycleName && (
            <span className="text-sm text-muted-foreground">{cycleName}</span>
          )}
        </div>
      </div>

      {/* Requests requiring attention callout */}
      {requestBadge > 0 && (
        <button
          type="button"
          onClick={() => router.push("/requests?filter=mine")}
          className="w-full flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 text-start transition-colors hover:bg-amber-50 active:bg-amber-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 shrink-0">
            <Bell size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{requestBadge} בקשות ממתינות לטיפולך</p>
            <p className="text-xs text-muted-foreground">לחץ כדי לצפות</p>
          </div>
        </button>
      )}

      {/* No cycle selected */}
      {!selectedCycleId && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
          <p className="text-lg font-medium">בחר מחזור</p>
          <p className="text-muted-foreground text-sm">בחר מחזור פעיל כדי לצפות בלוח הבקרה.</p>
        </div>
      )}

      {selectedCycleId && (
        <>
          {/* Squad commander — single card */}
          {role === "squad_commander" && squads.length > 0 && (
            <SquadSummaryCard squad={squads[0]} />
          )}

          {/* Platoon commander — aggregate + one card per squad */}
          {isPlatoon && (
            <div className="space-y-3">
              {squads.length > 1 && <AggregateRow squads={squads} />}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {squads.map((s) => (
                  <SquadSummaryCard key={s.squadId} squad={s} />
                ))}
              </div>
            </div>
          )}

          {/* Company commander — grouped by platoon */}
          {isCompany && (
            <div className="space-y-6">
              {platoons.map((platoon) => (
                <div key={platoon.platoonId} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {platoon.platoonName}
                    </h2>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  {platoon.squads.length > 1 && <AggregateRow squads={platoon.squads} />}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {platoon.squads.map((s) => (
                      <SquadSummaryCard key={s.squadId} squad={s} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {squads.length === 0 && !timedOut && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">טוען נתונים...</p>
            </div>
          )}

          {squads.length === 0 && timedOut && (
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
