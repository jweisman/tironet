"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SquadSummary } from "@/app/api/dashboard/route";
import type { VisibleSections } from "./PlatoonSummaryCard";
import { hebrewCount, hebrewLabel } from "@/lib/utils/hebrew-count";

interface Props {
  squad: SquadSummary;
  dataTour?: string;
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

export function SquadSummaryCard({ squad, dataTour, sections }: Props) {
  const router = useRouter();
  const hasGaps = squad.soldiersWithGaps > 0 || squad.missingReportActivities > 0;

  const showSoldiers = sections?.soldiers !== false;
  const showActivities = sections?.activities !== false;
  const showRequests = sections?.requests !== false;
  const showGaps = sections?.gaps !== false;

  return (
    <div
      data-tour={dataTour}
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
        <h3 className="font-semibold text-sm">{squad.squadName}</h3>
        {squad.commanders.length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {squad.commanders.join(", ")}
          </p>
        )}
      </div>

      {/* Stats columns */}
      <div className="flex border-b border-border">
        {/* Soldiers */}
        {showSoldiers && (
          <div data-tour="home-stats-soldiers" className="flex-1 min-w-0 px-3 py-3 space-y-1 border-e border-border last:border-e-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">חיילים</p>
            <StatButton onClick={() => router.push("/soldiers")}>
              <span className="text-xl font-bold">{squad.soldierCount}</span>
              <span className="text-xs text-muted-foreground">סה״כ</span>
            </StatButton>
            {squad.soldiersWithGaps > 0 ? (
              <StatButton onClick={() => router.push("/soldiers?filter=gaps")}>
                <span className="text-base font-bold text-amber-600">
                  {squad.soldiersWithGaps}
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
          <div data-tour="home-stats-activities" className="flex-1 min-w-0 px-3 py-3 space-y-1 border-e border-border last:border-e-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">פעילויות</p>
            <StatButton onClick={() => router.push("/activities")}>
              <span className="text-xl font-bold text-green-600">
                {squad.reportedActivities}
              </span>
              <span className="text-xs text-muted-foreground">{hebrewLabel(squad.reportedActivities, "דווח", "דווחו")}</span>
            </StatButton>
            {squad.missingReportActivities > 0 ? (
              <StatButton onClick={() => router.push("/activities?filter=gaps")}>
                <span className="text-base font-bold text-amber-600">
                  {squad.missingReportActivities}
                </span>
                <span className="text-xs text-muted-foreground">{hebrewLabel(squad.missingReportActivities, "חסר דיווח", "חסרות דיווח")}</span>
              </StatButton>
            ) : (
              <p className="text-xs text-green-600 font-medium py-0.5">הכל דווח</p>
            )}
          </div>
        )}

        {/* Requests */}
        {showRequests && (
          <div data-tour="home-stats-requests" className="flex-1 min-w-0 px-3 py-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">בקשות</p>
            {squad.approvedRequests > 0 ? (
              <StatButton onClick={() => router.push("/requests?filter=active")}>
                <span className="text-xl font-bold text-green-600">
                  {squad.approvedRequests}
                </span>
                <span className="text-xs text-muted-foreground">{hebrewLabel(squad.approvedRequests, "פעילה", "פעילות")}</span>
              </StatButton>
            ) : (
              <p className="text-xs text-muted-foreground py-0.5">—</p>
            )}
            {squad.inProgressRequests > 0 ? (
              <StatButton onClick={() => router.push("/requests")}>
                <span className="text-base font-bold text-amber-600">
                  {squad.inProgressRequests}
                </span>
                <span className="text-xs text-muted-foreground">{hebrewLabel(squad.inProgressRequests, "ממתינה", "ממתינות")}</span>
              </StatButton>
            ) : (
              <p className="text-xs text-muted-foreground py-0.5">—</p>
            )}
          </div>
        )}
      </div>

      {/* Top gap activities */}
      {showGaps && squad.topGapActivities.length > 0 && (
        <div>
          <p className="px-4 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">
            פערים
          </p>
          <div className="divide-y divide-border/60">
            {squad.topGapActivities.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => router.push(`/activities/${a.id}?gaps=1`)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 active:bg-muted transition-colors cursor-pointer text-start"
              >
                <span className="text-sm truncate flex-1">{a.name}</span>
                <div className="flex items-center gap-1.5 shrink-0 ms-3">
                  <span className="text-xs text-amber-700 font-semibold">
                    {hebrewCount(a.gapCount, "פער", "פערים")}
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
