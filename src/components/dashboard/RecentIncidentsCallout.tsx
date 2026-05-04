"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, AlertTriangle, ShieldAlert, ChevronDown, ChevronLeft } from "lucide-react";
import { useQuery } from "@powersync/react";
import { Badge } from "@/components/ui/badge";
import {
  INCIDENT_TYPE_LABELS,
  getSubtypeLabel,
  type IncidentType,
} from "@/lib/incidents/constants";
import { hebrewCount } from "@/lib/utils/hebrew-count";

const INITIAL_LIMIT = 3;

const TYPE_ICON: Record<IncidentType, { Icon: typeof Award; className: string }> = {
  commendation: { Icon: Award, className: "text-green-600" },
  discipline: { Icon: AlertTriangle, className: "text-amber-500" },
  safety: { Icon: ShieldAlert, className: "text-red-600" },
};

const TYPE_BADGE_CLASS: Record<IncidentType, string> = {
  commendation:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800",
  discipline:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800",
  safety:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800",
};

// Recent incidents: today + 6 prior days, scoped to the user's chain of command
// via PowerSync's visible_squad_ids CTE. Squad-level callers also pass squadId
// to narrow further (matching the dashboard pattern).
// Params: [cycleId, weekStart, squadId, squadId]
const RECENT_INCIDENTS_QUERY = `
  SELECT
    i.id,
    i.soldier_id,
    i.type,
    i.subtype,
    i.date,
    i.description,
    s.family_name || ' ' || s.given_name AS soldier_name,
    sq.name AS squad_name
  FROM incidents i
  JOIN soldiers s ON s.id = i.soldier_id
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE c.cycle_id = ?
    AND DATE(i.date) >= ?
    AND (? = '' OR s.squad_id = ?)
  ORDER BY i.date DESC, i.created_at DESC
`;

interface RawRecentIncident {
  id: string;
  soldier_id: string;
  type: string;
  subtype: string | null;
  date: string;
  description: string;
  soldier_name: string;
  squad_name: string;
}

interface Props {
  cycleId: string;
  squadId: string; // '' for platoon/company scope
}

export function RecentIncidentsCallout({ cycleId, squadId }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const weekStart = useMemo(() => {
    // Today (Israel time) minus 6 days = inclusive 7-day window ending today.
    const today = new Date(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()),
    );
    today.setUTCDate(today.getUTCDate() - 6);
    return today.toISOString().slice(0, 10);
  }, []);

  const params = useMemo(
    () => [cycleId, weekStart, squadId, squadId],
    [cycleId, weekStart, squadId],
  );
  const { data: raw } = useQuery<RawRecentIncident>(RECENT_INCIDENTS_QUERY, params);

  const incidents = raw ?? [];
  if (incidents.length === 0) return null;

  const hasMore = incidents.length > INITIAL_LIMIT;
  const visible = expanded ? incidents : incidents.slice(0, INITIAL_LIMIT);
  const hiddenCount = incidents.length - INITIAL_LIMIT;

  return (
    <div data-tour="home-recent-incidents" className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-muted-foreground" />
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          אירועים אחרונים
        </h2>
        <span className="text-xs text-muted-foreground">{incidents.length}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {visible.map((inc) => {
          const typeKey = inc.type as IncidentType;
          const iconConfig = TYPE_ICON[typeKey] ?? TYPE_ICON.discipline;
          const badgeClass = TYPE_BADGE_CLASS[typeKey] ?? TYPE_BADGE_CLASS.discipline;
          const typeLabel = INCIDENT_TYPE_LABELS[typeKey] ?? inc.type;
          const subtypeLabel = getSubtypeLabel(inc.type, inc.subtype);
          const Icon = iconConfig.Icon;
          const dateLabel = new Date(inc.date).toLocaleDateString("he-IL", {
            day: "numeric",
            month: "short",
          });
          return (
            <button
              key={inc.id}
              type="button"
              onClick={() => router.push(`/soldiers/${inc.soldier_id}`)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-muted/50 active:bg-muted"
            >
              <Icon size={16} className={`shrink-0 ${iconConfig.className}`} />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium truncate">{inc.soldier_name}</span>
                  <Badge variant="outline" className={`shrink-0 text-[10px] px-1.5 py-0.5 leading-none ${badgeClass}`}>
                    {typeLabel}{subtypeLabel ? ` · ${subtypeLabel}` : ""}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {dateLabel}{inc.description ? ` · ${inc.description}` : ""}
                </p>
              </div>
              <ChevronLeft size={12} className="shrink-0 text-muted-foreground/40" />
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
          <span>עוד {hebrewCount(hiddenCount, "אירוע", "אירועים")}</span>
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}
