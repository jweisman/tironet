"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CalendarDays, ChevronDown } from "lucide-react";
import { useQuery } from "@powersync/react";
import { ActivityTypeIcon } from "@/components/activities/ActivityTypeIcon";
import { cn } from "@/lib/utils";
import { hebrewCount } from "@/lib/utils/hebrew-count";

const INITIAL_LIMIT = 4;

// ---------------------------------------------------------------------------
// Query: today's activities with per-squad report counts
// Params: [cycleId, squadId, todayStr]
// squadId: scope to one squad (squad commander) or '' for all
// ---------------------------------------------------------------------------

const TODAY_ACTIVITIES_QUERY = `
  WITH
    cycle AS (SELECT ? AS id),
    sf    AS (SELECT ? AS squad_id),
    today AS (SELECT ? AS d),
    scope AS (
      SELECT sq.id AS squad_id, sq.platoon_id
      FROM squads sq
      JOIN platoons p ON p.id = sq.platoon_id
      JOIN companies c ON c.id = p.company_id
      WHERE c.cycle_id = (SELECT id FROM cycle)
        AND ((SELECT squad_id FROM sf) = '' OR sq.id = (SELECT squad_id FROM sf))
    )
  SELECT
    a.id,
    a.name,
    a.is_required,
    at.name  AS type_name,
    at.icon  AS type_icon,
    p.name   AS platoon_name,
    p.id     AS platoon_id,
    (SELECT COUNT(*)
     FROM soldiers s
     WHERE s.squad_id IN (SELECT squad_id FROM scope WHERE platoon_id = a.platoon_id)
       AND s.status = 'active'
       AND s.cycle_id = (SELECT id FROM cycle)
    ) AS total_soldiers,
    (SELECT COUNT(*)
     FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id
       AND s.squad_id IN (SELECT squad_id FROM scope WHERE platoon_id = a.platoon_id)
       AND s.status = 'active'
       AND s.cycle_id = (SELECT id FROM cycle)
    ) AS reported_count,
    (SELECT COUNT(*)
     FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id
       AND s.squad_id IN (SELECT squad_id FROM scope WHERE platoon_id = a.platoon_id)
       AND s.status = 'active'
       AND s.cycle_id = (SELECT id FROM cycle)
       AND ar.result = 'completed'
    ) AS passed_count,
    (SELECT COUNT(*)
     FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id
       AND s.squad_id IN (SELECT squad_id FROM scope WHERE platoon_id = a.platoon_id)
       AND s.status = 'active'
       AND s.cycle_id = (SELECT id FROM cycle)
       AND ar.result = 'skipped'
    ) AS failed_count
  FROM activities a
  JOIN activity_types at ON at.id = a.activity_type_id
  JOIN platoons p ON p.id = a.platoon_id
  WHERE a.cycle_id = (SELECT id FROM cycle)
    AND a.date = (SELECT d FROM today)
    AND a.status = 'active'
    AND a.platoon_id IN (SELECT DISTINCT platoon_id FROM scope)
  ORDER BY a.is_required DESC, a.name ASC
`;

interface RawTodayActivity {
  id: string;
  name: string;
  is_required: number;
  type_name: string;
  type_icon: string;
  platoon_name: string;
  platoon_id: string;
  total_soldiers: number;
  reported_count: number;
  passed_count: number;
  failed_count: number;
}

interface TodayActivity {
  id: string;
  name: string;
  isRequired: boolean;
  typeName: string;
  typeIcon: string;
  platoonName: string;
  platoonId: string;
  totalSoldiers: number;
  reportedCount: number;
  passedCount: number;
  failedCount: number;
  naCount: number;
  missingCount: number;
}

interface Props {
  cycleId: string;
  squadId: string; // '' for platoon/company scope
  showPlatoon?: boolean; // true for company commanders
}

export function TodayActivities({ cycleId, squadId, showPlatoon = false }: Props) {
  const router = useRouter();
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const params = useMemo(() => [cycleId, squadId, todayStr], [cycleId, squadId, todayStr]);
  const { data: raw } = useQuery<RawTodayActivity>(TODAY_ACTIVITIES_QUERY, params);

  const activities: TodayActivity[] = useMemo(
    () =>
      (raw ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        isRequired: r.is_required === 1,
        typeName: r.type_name,
        typeIcon: r.type_icon,
        platoonName: r.platoon_name,
        platoonId: r.platoon_id,
        totalSoldiers: Number(r.total_soldiers),
        reportedCount: Number(r.reported_count),
        passedCount: Number(r.passed_count),
        failedCount: Number(r.failed_count),
        naCount: Number(r.reported_count) - Number(r.passed_count) - Number(r.failed_count),
        missingCount: Number(r.total_soldiers) - Number(r.reported_count),
      })),
    [raw]
  );

  const [expanded, setExpanded] = useState(false);

  if (activities.length === 0) return null;

  const hasMore = activities.length > INITIAL_LIMIT;
  const visible = expanded ? activities : activities.slice(0, INITIAL_LIMIT);
  const hiddenCount = activities.length - INITIAL_LIMIT;

  return (
    <div data-tour="home-today-activities" className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarDays size={14} className="text-muted-foreground" />
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          פעילויות היום
        </h2>
        <span className="text-xs text-muted-foreground">{activities.length}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visible.map((a) => (
          <TodayActivityCard
            key={a.id}
            activity={a}
            showPlatoon={showPlatoon}
            onClick={() => router.push(`/activities/${a.id}`)}
          />
        ))}
      </div>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>עוד {hebrewCount(hiddenCount, "פעילות", "פעילויות")}</span>
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual activity card
// ---------------------------------------------------------------------------

function TodayActivityCard({
  activity: a,
  showPlatoon,
  onClick,
}: {
  activity: TodayActivity;
  showPlatoon: boolean;
  onClick: () => void;
}) {
  const total = a.totalSoldiers || 1; // avoid division by zero
  const passedPct = (a.passedCount / total) * 100;
  const failedPct = (a.failedCount / total) * 100;
  const naPct = (a.naCount / total) * 100;
  const missingPct = (a.missingCount / total) * 100;
  const isComplete = a.missingCount === 0 && a.failedCount === 0 && a.totalSoldiers > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-start transition-colors hover:bg-muted/50 active:bg-muted"
    >
      {/* Top row: icon, name, chevron */}
      <div className="flex items-center gap-3 w-full">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ActivityTypeIcon icon={a.typeIcon} name={a.typeName} size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm truncate block">{a.name}</span>
          {showPlatoon && (
            <span className="text-xs text-muted-foreground">{a.platoonName}</span>
          )}
        </div>

        <ChevronLeft size={14} className="shrink-0 text-muted-foreground/40" />
      </div>

      {/* Stacked progress bar + fraction */}
      <div className="flex items-center gap-3 w-full">
        <div className="flex flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          {passedPct > 0 && (
            <div
              className="h-full bg-green-500 dark:bg-green-400 transition-all duration-300"
              style={{ width: `${passedPct}%` }}
            />
          )}
          {failedPct > 0 && (
            <div
              className="h-full bg-red-500 dark:bg-red-400 transition-all duration-300"
              style={{ width: `${failedPct}%` }}
            />
          )}
          {naPct > 0 && (
            <div
              className="h-full bg-muted-foreground/30 transition-all duration-300"
              style={{ width: `${naPct}%` }}
            />
          )}
          {missingPct > 0 && (
            <div
              className="h-full bg-amber-400 dark:bg-amber-500 transition-all duration-300"
              style={{ width: `${missingPct}%` }}
            />
          )}
        </div>
        <span
          className={cn(
            "text-xs font-bold tabular-nums shrink-0",
            isComplete
              ? "text-green-600 dark:text-green-400"
              : "text-muted-foreground"
          )}
        >
          {a.reportedCount}/{a.totalSoldiers}
        </span>
      </div>
    </button>
  );
}
