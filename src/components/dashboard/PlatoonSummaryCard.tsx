"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SquadSummary } from "@/app/api/dashboard/route";

export type VisibleSections = {
  soldiers?: boolean;
  activities?: boolean;
  requests?: boolean;
  gaps?: boolean;
};

interface Props {
  platoonName: string;
  squads: SquadSummary[];
  sections?: VisibleSections;
}

function StatButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between -mx-1 px-1 py-0.5 rounded-md hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer group"
    >
      <div className="flex items-baseline gap-1.5">{children}</div>
      <ChevronLeft
        size={12}
        className="shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors"
      />
    </button>
  );
}

export function PlatoonSummaryCard({ platoonName, squads, sections }: Props) {
  const router = useRouter();

  const showSoldiers = sections?.soldiers !== false;
  const showActivities = sections?.activities !== false;
  const showRequests = sections?.requests !== false;
  const showGaps = sections?.gaps !== false;

  // Aggregate stats across squads
  const total = squads.reduce(
    (acc, s) => ({
      soldierCount: acc.soldierCount + s.soldierCount,
      soldiersWithGaps: acc.soldiersWithGaps + s.soldiersWithGaps,
      reportedActivities: acc.reportedActivities + s.reportedActivities,
      missingReportActivities: acc.missingReportActivities + s.missingReportActivities,
      approvedRequests: acc.approvedRequests + s.approvedRequests,
      inProgressRequests: acc.inProgressRequests + s.inProgressRequests,
    }),
    {
      soldierCount: 0,
      soldiersWithGaps: 0,
      reportedActivities: 0,
      missingReportActivities: 0,
      approvedRequests: 0,
      inProgressRequests: 0,
    }
  );

  // Aggregate top gap activities across squads — combine by activity ID
  const gapMap = new Map<string, { id: string; name: string; gapCount: number }>();
  for (const s of squads) {
    for (const g of s.topGapActivities) {
      const existing = gapMap.get(g.id);
      if (existing) {
        existing.gapCount += g.gapCount;
      } else {
        gapMap.set(g.id, { ...g });
      }
    }
  }
  const topGaps = Array.from(gapMap.values())
    .sort((a, b) => b.gapCount - a.gapCount)
    .slice(0, 3);

  const hasGaps = total.soldiersWithGaps > 0 || total.missingReportActivities > 0;

  const visibleColumnCount = [showSoldiers, showActivities, showRequests].filter(Boolean).length;

  return (
    <div
      className={`rounded-xl border bg-card overflow-hidden ${
        hasGaps ? "border-amber-200" : "border-border"
      }`}
    >
      {/* Header */}
      <div
        className={`px-4 py-3 border-b border-border ${
          hasGaps ? "bg-amber-50/50 dark:bg-amber-950/20" : "bg-muted/30"
        }`}
      >
        <h3 className="font-semibold text-sm">{platoonName}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {squads.length} כיתות
        </p>
      </div>

      {/* Stats columns */}
      {visibleColumnCount > 0 && (
        <div className="flex border-b border-border">
          {/* Soldiers */}
          {showSoldiers && (
            <div className="flex-1 min-w-0 px-3 py-3 space-y-1 border-e border-border last:border-e-0">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">חיילים</p>
              <StatButton onClick={() => router.push("/soldiers")}>
                <span className="text-xl font-bold">{total.soldierCount}</span>
                <span className="text-xs text-muted-foreground">סה״כ</span>
              </StatButton>
              {total.soldiersWithGaps > 0 ? (
                <StatButton onClick={() => router.push("/soldiers?filter=gaps")}>
                  <span className="text-base font-bold text-amber-600">
                    {total.soldiersWithGaps}
                  </span>
                  <span className="text-xs text-muted-foreground">עם פערים</span>
                </StatButton>
              ) : (
                <p className="text-xs text-green-600 font-medium py-0.5">ללא פערים</p>
              )}
            </div>
          )}

          {/* Activities */}
          {showActivities && (
            <div className="flex-1 min-w-0 px-3 py-3 space-y-1 border-e border-border last:border-e-0">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">פעילויות</p>
              <StatButton onClick={() => router.push("/activities")}>
                <span className="text-xl font-bold text-green-600">
                  {total.reportedActivities}
                </span>
                <span className="text-xs text-muted-foreground">דווחו</span>
              </StatButton>
              {total.missingReportActivities > 0 ? (
                <StatButton onClick={() => router.push("/activities?filter=gaps")}>
                  <span className="text-base font-bold text-amber-600">
                    {total.missingReportActivities}
                  </span>
                  <span className="text-xs text-muted-foreground">חסרות דיווח</span>
                </StatButton>
              ) : (
                <p className="text-xs text-green-600 font-medium py-0.5">הכל דווח</p>
              )}
            </div>
          )}

          {/* Requests */}
          {showRequests && (
            <div className="flex-1 min-w-0 px-3 py-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">בקשות</p>
              {total.approvedRequests > 0 ? (
                <StatButton onClick={() => router.push("/requests?tab=approved")}>
                  <span className="text-xl font-bold text-green-600">
                    {total.approvedRequests}
                  </span>
                  <span className="text-xs text-muted-foreground">אושרו</span>
                </StatButton>
              ) : (
                <p className="text-xs text-muted-foreground py-0.5">—</p>
              )}
              {total.inProgressRequests > 0 ? (
                <StatButton onClick={() => router.push("/requests")}>
                  <span className="text-base font-bold text-amber-600">
                    {total.inProgressRequests}
                  </span>
                  <span className="text-xs text-muted-foreground">בטיפול</span>
                </StatButton>
              ) : (
                <p className="text-xs text-muted-foreground py-0.5">—</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top gap activities */}
      {showGaps && topGaps.length > 0 && (
        <div>
          <p className="px-4 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">
            פערים
          </p>
          <div className="divide-y divide-border/60">
            {topGaps.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => router.push(`/activities/${a.id}?gaps=1`)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer text-start"
              >
                <span className="text-sm truncate flex-1">{a.name}</span>
                <div className="flex items-center gap-1.5 shrink-0 ms-3">
                  <span className="text-xs text-amber-700 font-semibold">
                    {a.gapCount} פערים
                  </span>
                  <ChevronLeft size={12} className="text-muted-foreground/50" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
