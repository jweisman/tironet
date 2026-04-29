"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { PieChart, PieChartLegend } from "@/components/reports/PieChart";
import { cn } from "@/lib/utils";
import { formatGradeDisplay } from "@/lib/score-format";
import { formatAppointment } from "@/lib/requests/medical-appointments";
import { formatSickDay } from "@/lib/requests/sick-days";
import { extractRequestFields, formatNotes } from "@/lib/reports/detail-columns";
import { RequestDetailColumns } from "@/components/reports/RequestDetailColumns";
import { AttendanceTable } from "@/components/reports/AttendanceTable";
import { REQUEST_STATUS_LABELS, ASSIGNED_ROLE_LABELS } from "@/lib/requests/constants";
import type { RequestStatus, Role } from "@/types";
import { getResultLabels } from "@/types/display-config";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import type {
  DailyForumData,
  PlatoonForumSection,
  OpenRequestItem,
  TodayActivityItem,
  GapActivityItem,
  AttendanceSummaryPlatoon,
} from "@/app/api/reports/daily-forum/route";

// ---------------------------------------------------------------------------
// Request details renderer
// ---------------------------------------------------------------------------

const TRANSPORTATION_LABELS: Record<string, string> = {
  public_transit: 'תחב"צ',
  shuttle: "שאטל",
  military_transport: "נסיעה צבאית",
  other: "אחר",
};

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

const clientFormatters = {
  text: (s: string) => s,
  dateTime: formatDateTime,
  date: formatDate,
  appointment: formatAppointment,
  sickDay: formatSickDay,
  transportationLabels: TRANSPORTATION_LABELS,
};

function RequestCard({ req, highlightDates }: { req: OpenRequestItem; highlightDates?: boolean }) {
  const { fields, appointments, sickDays } = extractRequestFields(req, clientFormatters, { highlightDates });

  const notes = formatNotes(req.notes);

  return (
    <div className="border-b border-border py-2 px-1">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm">{req.soldierName}</span>
        <span className="text-xs text-muted-foreground">{req.squad}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(req.createdAt).toLocaleDateString("he-IL", { day: "numeric", month: "short" })}
        </span>
        <span className="ms-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {REQUEST_STATUS_LABELS[req.status as RequestStatus] ?? req.status}
          </span>
          {req.assignedRole && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-800/60 dark:text-amber-100">
              ממתין ל{ASSIGNED_ROLE_LABELS[req.assignedRole as Role] ?? req.assignedRole}
            </span>
          )}
        </span>
      </div>
      <RequestDetailColumns data={{ fields, appointments, sickDays, notes }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request type section
// ---------------------------------------------------------------------------

function RequestTypeSection({ title, requests, highlightDates }: { title: string; requests: OpenRequestItem[]; highlightDates?: boolean }) {
  if (requests.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold bg-muted px-2 py-1 rounded-sm mb-1">
        {title} ({requests.length})
      </div>
      {requests.map((req) => (
        <RequestCard key={req.id} req={req} highlightDates={highlightDates} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today activity section
// ---------------------------------------------------------------------------

function TodayActivitySection({ activity }: { activity: TodayActivityItem }) {
  return (
    <section className="space-y-3 mb-6">
      <div className="border-b border-border pb-1">
        <h3 className="text-sm font-bold">
          {activity.activityTypeName} — {activity.name}
        </h3>
        <p className="text-xs text-muted-foreground">
          {new Date(activity.date).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="flex items-center gap-6">
        <PieChart
          data={{ completed: activity.completedCount, skipped: activity.skippedCount, failed: activity.failedCount, na: activity.naCount, missing: activity.missingCount }}
          size={80}
        />
        <div className="space-y-1">
          <PieChartLegend
            data={{ completed: activity.completedCount, skipped: activity.skippedCount, failed: activity.failedCount, na: activity.naCount, missing: activity.missingCount }}
            resultLabels={getResultLabels(activity.displayConfiguration)}
          />
          <p className="text-xs text-muted-foreground">
            סה&quot;כ {hebrewCount(activity.totalSoldiers, "חייל", "חיילים")}
          </p>
        </div>
      </div>

      {activity.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-start px-2 py-1.5 font-semibold">פלוגה</th>
                <th className="text-start px-2 py-1.5 font-semibold">מחלקה</th>
                <th className="text-start px-2 py-1.5 font-semibold">כיתה</th>
                {(activity.scoreLabels ?? []).map((label, i) => (
                  <th key={i} className="text-start px-2 py-1.5 font-semibold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activity.rows.map((row, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-b border-border",
                    row.level === "platoon" && "bg-muted/50 font-medium",
                    row.level === "company" && "bg-muted font-bold",
                  )}
                >
                  <td className="px-2 py-1.5">{row.company}</td>
                  <td className="px-2 py-1.5">{row.platoon}</td>
                  <td className="px-2 py-1.5">{row.squad}</td>
                  {row.averages.map((avg, j) => (
                    <td key={j} className="px-2 py-1.5">
                      {avg != null ? formatGradeDisplay(avg, activity.scoreFormats?.[j]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Gaps section
// ---------------------------------------------------------------------------

function GapSection({ gap }: { gap: GapActivityItem }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-semibold">
          {gap.activityTypeName} — {gap.name}
        </span>
        <span className="text-xs text-muted-foreground">
          ({new Date(gap.date).toLocaleDateString("he-IL")})
        </span>
        <span className="text-xs font-semibold text-destructive">
          {hebrewCount(gap.soldiers.length, "פער", "פערים")}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-start px-2 py-1 font-semibold">חייל</th>
              <th className="text-start px-2 py-1 font-semibold">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {gap.soldiers.map((s, i) => (
              <tr key={i} className="border-b border-border">
                <td className="px-2 py-1">{s.name}</td>
                <td className="px-2 py-1">
                  {s.result === "skipped" ? (
                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">{getResultLabels(gap.displayConfiguration).skipped.label}</span>
                  ) : s.result === "failed" ? (
                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">נכשל</span>
                  ) : (
                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">חסר</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platoon section
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Topic-first rendering helpers
// ---------------------------------------------------------------------------

function PlatoonLabel({ platoon }: { platoon: PlatoonForumSection }) {
  return (
    <div className="text-xs font-semibold text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1 mt-2">
      {platoon.companyName} — {platoon.platoonName}
    </div>
  );
}

function ForumContent({ data }: { data: DailyForumData }) {
  const platoons = data.platoons;
  const multi = platoons.length > 1;
  const totalOpen = platoons.reduce((s, p) => s + p.openRequests.medical.length + p.openRequests.hardship.length + p.openRequests.leave.length, 0);
  const totalActive = platoons.reduce((s, p) => s + p.activeRequests.medical.length + p.activeRequests.leave.length, 0);

  return (
    <>
      {/* סיכום נוכחות */}
      <div className="mb-6">
        <h2 className="text-sm font-bold bg-muted px-3 py-1.5 rounded-sm border-r-4 border-foreground mb-3">
          סיכום נוכחות
        </h2>
        {data.attendance.length === 0 ? (
          <p className="text-xs text-muted-foreground">אין נתונים</p>
        ) : (
          data.attendance.map((p) => (
            <div key={p.platoonName} className="mb-4">
              {data.attendance.length > 1 && (
                <div className="text-xs font-semibold text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1 mt-2">
                  {p.platoonName} ({p.presentCount}/{p.totalCount})
                </div>
              )}
              {data.attendance.length === 1 && (
                <p className="text-sm font-semibold mb-2">נוכחים: {p.presentCount}/{p.totalCount}</p>
              )}
              <AttendanceTable rows={p.absent} showSquad />
            </div>
          ))
        )}
      </div>

      {/* בקשות */}
      <div className="mb-6">
        <h2 className="text-sm font-bold bg-muted px-3 py-1.5 rounded-sm border-r-4 border-foreground mb-3">
          בקשות
        </h2>

        <div className="mb-5">
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            ממתינות ({totalOpen})
          </h3>
          {totalOpen === 0 ? (
            <p className="text-xs text-muted-foreground">אין בקשות ממתינות</p>
          ) : (
            <>
              <RequestTypePlatoons title="רפואה" platoons={platoons} getRequests={(p) => p.openRequests.medical} multi={multi} />
              <RequestTypePlatoons title='ת"ש' platoons={platoons} getRequests={(p) => p.openRequests.hardship} multi={multi} />
              <RequestTypePlatoons title="יציאה" platoons={platoons} getRequests={(p) => p.openRequests.leave} multi={multi} />
            </>
          )}
        </div>

        <div className="mb-5">
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            פעילות ({totalActive})
          </h3>
          {totalActive === 0 ? (
            <p className="text-xs text-muted-foreground">אין בקשות פעילות</p>
          ) : (
            <>
              <RequestTypePlatoons title="רפואה" platoons={platoons} getRequests={(p) => p.activeRequests.medical} multi={multi} highlightDates />
              <RequestTypePlatoons title="יציאה" platoons={platoons} getRequests={(p) => p.activeRequests.leave} multi={multi} highlightDates />
            </>
          )}
        </div>
      </div>

      {/* הספקים */}
      <div className="mb-6">
        <h2 className="text-sm font-bold bg-muted px-3 py-1.5 rounded-sm border-r-4 border-foreground mb-3">
          הספקים
        </h2>

        <div className="mb-5">
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            פעילויות היום
          </h3>
          {platoons.every((p) => p.todayActivities.length === 0) ? (
            <p className="text-xs text-muted-foreground">אין פעילויות להיום</p>
          ) : (
            platoons.map((p) => {
              if (p.todayActivities.length === 0) return null;
              return (
                <div key={p.platoonId}>
                  {multi && <PlatoonLabel platoon={p} />}
                  {p.todayActivities.map((a) => (
                    <TodayActivitySection key={a.id} activity={a} />
                  ))}
                </div>
              );
            })
          )}
        </div>

        <div>
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            פעילויות מחר
          </h3>
          {platoons.every((p) => p.tomorrowActivities.length === 0) ? (
            <p className="text-xs text-muted-foreground">אין פעילויות למחר</p>
          ) : (
            platoons.map((p) => {
              if (p.tomorrowActivities.length === 0) return null;
              return (
                <div key={p.platoonId}>
                  {multi && <PlatoonLabel platoon={p} />}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b-2 border-border">
                          <th className="text-start px-2 py-1.5 font-semibold">סוג</th>
                          <th className="text-start px-2 py-1.5 font-semibold">שם</th>
                          <th className="text-start px-2 py-1.5 font-semibold">חובה</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.tomorrowActivities.map((a) => (
                          <tr key={a.id} className="border-b border-border">
                            <td className="px-2 py-1.5">{a.activityTypeName}</td>
                            <td className="px-2 py-1.5">{a.name}</td>
                            <td className="px-2 py-1.5">
                              {a.isRequired ? (
                                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">חובה</span>
                              ) : (
                                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">רשות</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* תכנון מול ביצוע */}
      <div>
        <h2 className="text-sm font-bold bg-muted px-3 py-1.5 rounded-sm border-r-4 border-foreground mb-3">
          תכנון מול ביצוע
        </h2>
        <div>
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            פערים
          </h3>
          {platoons.every((p) => p.gaps.length === 0) ? (
            <p className="text-xs text-muted-foreground">אין פערים</p>
          ) : (
            platoons.map((p) => {
              if (p.gaps.length === 0) return null;
              return (
                <div key={p.platoonId}>
                  {multi && <PlatoonLabel platoon={p} />}
                  {p.gaps.map((g) => <GapSection key={g.id} gap={g} />)}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

/** Renders a request type across all platoons (topic → platoon grouping). */
function RequestTypePlatoons({
  title, platoons, getRequests, multi, highlightDates,
}: {
  title: string;
  platoons: PlatoonForumSection[];
  getRequests: (p: PlatoonForumSection) => OpenRequestItem[];
  multi: boolean;
  highlightDates?: boolean;
}) {
  const all = platoons.flatMap((p) => getRequests(p));
  if (all.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="text-xs font-semibold bg-muted px-2 py-1 rounded mb-1">
        {title} ({all.length})
      </div>
      {platoons.map((p) => {
        const reqs = getRequests(p);
        if (reqs.length === 0) return null;
        return (
          <div key={p.platoonId}>
            {multi && <PlatoonLabel platoon={p} />}
            {reqs.map((r) => (
              <RequestCard key={r.id} req={r} highlightDates={highlightDates} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DailyForumPage() {
  const router = useRouter();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<DailyForumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    fetch(`/api/reports/daily-forum?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: DailyForumData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      const res = await fetch(`/api/reports/daily-forum/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-forum-${data?.date || "report"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("הדוח הופק בהצלחה");
    } catch {
      toast.error("שגיאה בהפקת ה-PDF");
    } finally {
      setPdfLoading(false);
    }
  }

  if (cycleLoading) return null;

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
      </div>
    );
  }

  const dateDisplay = data
    ? new Date(data.date + "T12:00:00").toLocaleDateString("he-IL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/reports")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowRight size={20} />
          </button>
          <h1 className="text-lg font-bold flex-1">דוח פורום יומי</h1>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={pdfLoading || loading}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {pdfLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            <span className="hidden sm:inline">ייצוא ל-PDF</span>
          </button>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground mt-1">
            מחזור {data.cycleName} — {dateDisplay}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && data.platoons.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין נתונים להצגה</p>
          </div>
        )}

        {!loading && data && data.platoons.length > 0 && (
          <ForumContent data={data} />
        )}
      </div>
    </div>
  );
}
