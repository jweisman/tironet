"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
import { CyclePicker } from "@/components/CyclePicker";
import { SquadSummaryCard } from "@/components/dashboard/SquadSummaryCard";
import type { SquadSummary } from "@/app/api/dashboard/route";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_SHORT: Record<string, string> = {
  squad_commander: 'מ"כ',
  platoon_commander: 'מ"מ',
  company_commander: 'מ"פ',
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
    }),
    { soldiers: 0, withGaps: 0, reported: 0, missing: 0 }
  );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs flex-wrap">
      <span className="text-muted-foreground">{total.soldiers} חיילים</span>
      {total.withGaps > 0 && (
        <span className="text-amber-600 font-semibold">{total.withGaps} עם פערים</span>
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
  ORDER BY p.sort_order ASC, sq.sort_order ASC
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
    WHERE sq.id IN (SELECT squad_id FROM scope)
  ) g
  WHERE g.gap_count > 0
  ORDER BY g.squad_id, g.gap_count DESC
`;

interface RawSquad {
  squad_id: string; squad_name: string;
  platoon_id: string; platoon_name: string;
  soldier_count: number; soldiers_with_gaps: number;
  reported_activities: number; missing_report_activities: number;
}
interface RawTopGap {
  squad_id: string; activity_id: string; activity_name: string; gap_count: number;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HomePage() {
  const { data: session } = useSession();
  const { selectedCycleId, selectedAssignment, activeCycles } = useCycle();

  const role = selectedAssignment?.role ?? "";
  const squadId = role === "squad_commander" ? (selectedAssignment?.unitId ?? "") : "";

  const queryParams = useMemo(
    () => [selectedCycleId ?? "", squadId],
    [selectedCycleId, squadId]
  );

  const { data: rawSquads } = useQuery<RawSquad>(SQUADS_QUERY, queryParams);
  const { data: rawTopGaps } = useQuery<RawTopGap>(TOP_GAPS_QUERY, queryParams);

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
        topGapActivities: topGapsMap.get(raw.squad_id) ?? [],
      })),
    [rawSquads, topGapsMap]
  );

  // No active cycles
  if (activeCycles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין לך גישה למחזור פעיל</p>
        <p className="text-muted-foreground text-sm">פנה למפקד שלך כדי לקבל הזמנה.</p>
      </div>
    );
  }

  // Multiple cycles, none selected
  if (!selectedAssignment && activeCycles.length > 1) {
    return <CyclePicker />;
  }

  const user = session?.user;
  const cycleName = selectedAssignment?.cycleName ?? activeCycles[0]?.cycleName ?? "";

  // Group squads by platoon for company commander view
  const platoonMap = new Map<string, { platoonId: string; platoonName: string; squads: SquadSummary[] }>();
  for (const s of squads) {
    if (!platoonMap.has(s.platoonId)) {
      platoonMap.set(s.platoonId, { platoonId: s.platoonId, platoonName: s.platoonName, squads: [] });
    }
    platoonMap.get(s.platoonId)!.squads.push(s);
  }
  const platoons = Array.from(platoonMap.values());

  const isCompany = role === "company_commander";
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
          {role && (
            <span className="text-sm font-medium text-primary">
              {ROLE_SHORT[role] ?? role}
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

      {/* No cycle selected */}
      {!selectedCycleId && (
        <p className="text-muted-foreground text-sm">בחר מחזור כדי לצפות בלוח הבקרה.</p>
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

          {squads.length === 0 && (
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
