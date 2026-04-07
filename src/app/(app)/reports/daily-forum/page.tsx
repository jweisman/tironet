"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { PieChart, PieChartLegend } from "@/components/reports/PieChart";
import { cn } from "@/lib/utils";
import { formatGradeDisplay } from "@/lib/score-format";
import type {
  DailyForumData,
  PlatoonForumSection,
  OpenRequestItem,
  TodayActivityItem,
  GapActivityItem,
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

function RequestCard({ req }: { req: OpenRequestItem }) {
  const details: string[] = [];
  if (req.description) details.push(`תיאור: ${req.description}`);

  if (req.type === "leave") {
    if (req.place) details.push(`מקום: ${req.place}`);
    if (req.departureAt) details.push(`יציאה: ${new Date(req.departureAt).toLocaleDateString("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);
    if (req.returnAt) details.push(`חזרה: ${new Date(req.returnAt).toLocaleDateString("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);
    if (req.transportation) details.push(`הגעה: ${TRANSPORTATION_LABELS[req.transportation] ?? req.transportation}`);
  }

  if (req.type === "medical") {
    if (req.paramedicDate) details.push(`בדיקת חופ"ל: ${new Date(req.paramedicDate).toLocaleDateString("he-IL")}`);
    if (req.appointmentDate) details.push(`תור: ${new Date(req.appointmentDate).toLocaleDateString("he-IL")}`);
    if (req.appointmentPlace) details.push(`מקום: ${req.appointmentPlace}`);
    if (req.appointmentType) details.push(`סוג: ${req.appointmentType}`);
    if (req.sickLeaveDays != null) details.push(`ימי גימלים: ${req.sickLeaveDays}`);
  }

  if (req.type === "hardship" && req.specialConditions != null) {
    details.push(`אוכלוסיות מיוחדות: ${req.specialConditions ? "כן" : "לא"}`);
  }

  if (req.latestNote) details.push(`הערה: ${req.latestNote}`);

  return (
    <div className="border-b border-border py-2 px-1">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-sm">{req.soldierName}</span>
        <span className="text-xs text-muted-foreground">{req.squad}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(req.createdAt).toLocaleDateString("he-IL", { day: "numeric", month: "short" })}
        </span>
      </div>
      {details.length > 0 && (
        <p className="text-xs text-muted-foreground mt-0.5">
          {details.join(" · ")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request type section
// ---------------------------------------------------------------------------

function RequestTypeSection({ title, requests }: { title: string; requests: OpenRequestItem[] }) {
  if (requests.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold bg-muted px-2 py-1 rounded-sm mb-1">
        {title} ({requests.length})
      </div>
      {requests.map((req) => (
        <RequestCard key={req.id} req={req} />
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
          passed={activity.passedCount}
          failed={activity.failedCount}
          na={activity.naCount}
          size={80}
        />
        <div className="space-y-1">
          <PieChartLegend
            passed={activity.passedCount}
            failed={activity.failedCount}
            na={activity.naCount}
          />
          <p className="text-xs text-muted-foreground">
            סה&quot;כ {activity.totalSoldiers} חיילים
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
          {gap.soldiers.length} פערים
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
                  {s.result === "failed" ? (
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

function PlatoonSection({ platoon, multiPlatoon }: { platoon: PlatoonForumSection; multiPlatoon: boolean }) {
  const totalRequests = platoon.openRequests.medical.length + platoon.openRequests.hardship.length + platoon.openRequests.leave.length;

  return (
    <div className="mb-8">
      {multiPlatoon && (
        <div className="bg-foreground text-background px-3 py-2 rounded-lg mb-4 font-bold text-sm">
          {platoon.companyName} — {platoon.platoonName}
        </div>
      )}

      {/* Open requests */}
      <div className="mb-6">
        <h2 className="text-sm font-bold border-b border-border pb-1 mb-3">
          בקשות פתוחות ({totalRequests})
        </h2>
        {totalRequests === 0 ? (
          <p className="text-xs text-muted-foreground">אין בקשות פתוחות</p>
        ) : (
          <>
            <RequestTypeSection title="רפואה" requests={platoon.openRequests.medical} />
            <RequestTypeSection title='ת"ש' requests={platoon.openRequests.hardship} />
            <RequestTypeSection title="יציאה" requests={platoon.openRequests.leave} />
          </>
        )}
      </div>

      {/* הספקים */}
      <div className="mb-6">
        <h2 className="text-sm font-bold bg-muted px-3 py-1.5 rounded-sm border-r-4 border-foreground mb-3">
          הספקים
        </h2>

        {/* Today's activities */}
        <div className="mb-5">
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            פעילויות היום
          </h3>
          {platoon.todayActivities.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין פעילויות להיום</p>
          ) : (
            platoon.todayActivities.map((a) => (
              <TodayActivitySection key={a.id} activity={a} />
            ))
          )}
        </div>

        {/* Tomorrow's activities */}
        <div>
          <h3 className="text-sm font-bold border-b border-border pb-1 mb-3">
            פעילויות מחר
          </h3>
          {platoon.tomorrowActivities.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין פעילויות למחר</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="text-start px-2 py-1.5 font-semibold">סוג</th>
                    <th className="text-start px-2 py-1.5 font-semibold">שם</th>
                    <th className="text-start px-2 py-1.5 font-semibold">סטטוס</th>
                    <th className="text-start px-2 py-1.5 font-semibold">חובה</th>
                  </tr>
                </thead>
                <tbody>
                  {platoon.tomorrowActivities.map((a) => (
                    <tr key={a.id} className="border-b border-border">
                      <td className="px-2 py-1.5">{a.activityTypeName}</td>
                      <td className="px-2 py-1.5">{a.name}</td>
                      <td className="px-2 py-1.5">
                        {a.status === "active" ? (
                          <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-800">פעיל</span>
                        ) : (
                          <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">טיוטה</span>
                        )}
                      </td>
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
          {platoon.gaps.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין פערים</p>
          ) : (
            platoon.gaps.map((g) => <GapSection key={g.id} gap={g} />)
          )}
        </div>
      </div>
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

        {!loading &&
          data?.platoons.map((platoon) => (
            <PlatoonSection
              key={platoon.platoonId}
              platoon={platoon}
              multiPlatoon={data.platoons.length > 1}
            />
          ))}
      </div>
    </div>
  );
}
