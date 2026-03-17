"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";
import { CyclePicker } from "@/components/CyclePicker";
import { SquadSummaryCard } from "@/components/dashboard/SquadSummaryCard";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";
import type { DashboardResponse, SquadSummary } from "@/app/api/dashboard/route";

const ROLE_SHORT: Record<string, string> = {
  squad_commander: 'מ"כ',
  platoon_commander: 'מ"מ',
  company_commander: 'מ"פ',
};

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

export default function HomePage() {
  const { data: session } = useSession();
  const { selectedCycleId, selectedAssignment, activeCycles } = useCycle();
  const [dashData, setDashData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedCycleId) {
      setDashData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/dashboard?cycleId=${selectedCycleId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DashboardResponse | null) => setDashData(d))
      .catch(() => setDashData(null))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

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
  const role = dashData?.role ?? selectedAssignment?.role ?? null;
  const cycleName = selectedAssignment?.cycleName ?? activeCycles[0]?.cycleName ?? "";

  // Group squads by platoon for company/admin view
  const squads = dashData?.squads ?? [];
  const platoonMap = new Map<string, { platoonId: string; platoonName: string; squads: SquadSummary[] }>();
  for (const s of squads) {
    if (!platoonMap.has(s.platoonId)) {
      platoonMap.set(s.platoonId, { platoonId: s.platoonId, platoonName: s.platoonName, squads: [] });
    }
    platoonMap.get(s.platoonId)!.squads.push(s);
  }
  const platoons = Array.from(platoonMap.values());

  const isCompanyOrAdmin = role === "company_commander";
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          טוען...
        </div>
      )}

      {/* No cycle selected */}
      {!loading && !selectedCycleId && (
        <p className="text-muted-foreground text-sm">בחר מחזור כדי לצפות בלוח הבקרה.</p>
      )}

      {/* Dashboard content */}
      {!loading && dashData && (
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

          {/* Company commander / admin — grouped by platoon */}
          {isCompanyOrAdmin && (
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
