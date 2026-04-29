"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { PieChart, PieChartLegend } from "@/components/reports/PieChart";
import type {
  ActivitySummaryData,
  ActivitySummaryRow,
} from "@/app/api/reports/activity-summary/route";
import { cn } from "@/lib/utils";
import { formatGradeDisplay } from "@/lib/score-format";
import { getResultLabels } from "@/types/display-config";
import { hebrewCount } from "@/lib/utils/hebrew-count";

export default function ActivitySummaryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<ActivitySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  const typesParam = searchParams.get("types") ?? "";
  const dateRange = searchParams.get("dateRange") ?? "";

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    if (typesParam) params.set("activityTypeIds", typesParam);
    if (dateRange) params.set("dateRange", dateRange);
    fetch(`/api/reports/activity-summary?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: ActivitySummaryData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId, typesParam, dateRange]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      if (typesParam) params.set("activityTypeIds", typesParam);
      if (dateRange) params.set("dateRange", dateRange);
      const res = await fetch(
        `/api/reports/activity-summary/pdf?${params}`
      );
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-summary-${data?.cycleName || "report"}.pdf`;
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
          <h1 className="text-lg font-bold flex-1">סיכום פעילויות</h1>
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
            מחזור {data.cycleName} — {hebrewCount(data.activities.length, "פעילות", "פעילויות")}
            {dateRange === "week" && " · שבוע אחרון"}
            {dateRange === "month" && " · חודש אחרון"}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-8 pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && data.activities.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין פעילויות פעילות במחזור זה</p>
          </div>
        )}

        {!loading &&
          data?.activities.map((activity) => (
            <section key={activity.id} className="space-y-4">
              {/* Activity header */}
              <div className="border-b border-border pb-2">
                <h2 className="text-base font-bold">
                  {activity.activityTypeName} — {activity.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {new Date(activity.date).toLocaleDateString("he-IL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>

              {/* Pie chart + legend */}
              <div className="flex items-center gap-6">
                <PieChart
                  passed={activity.passedCount}
                  failed={activity.failedCount}
                  na={activity.naCount}
                  size={100}
                />
                <div className="space-y-2">
                  <PieChartLegend
                    passed={activity.passedCount}
                    failed={activity.failedCount}
                    na={activity.naCount}
                    resultLabels={getResultLabels(activity.displayConfiguration)}
                  />
                  <p className="text-xs text-muted-foreground">
                    סה&quot;כ {hebrewCount(activity.totalSoldiers, "חייל", "חיילים")}
                  </p>
                </div>
              </div>

              {/* Rollup table */}
              {activity.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b-2 border-border">
                        <th className="text-start px-3 py-2 font-semibold">
                          פלוגה
                        </th>
                        <th className="text-start px-3 py-2 font-semibold">
                          מחלקה
                        </th>
                        <th className="text-start px-3 py-2 font-semibold">
                          כיתה
                        </th>
                        {(activity.scoreLabels ?? ["ממוצע"]).map((label, i) => (
                          <th key={i} className="text-start px-3 py-2 font-semibold">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activity.rows.map((row, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-border",
                            row.level === "platoon" &&
                              "bg-muted/50 font-medium",
                            row.level === "company" &&
                              "bg-muted font-bold"
                          )}
                        >
                          <td className="px-3 py-2">{row.company}</td>
                          <td className="px-3 py-2">{row.platoon}</td>
                          <td className="px-3 py-2">{row.squad}</td>
                          {row.averages.map((avg, j) => (
                            <td key={j} className="px-3 py-2">
                              {avg != null ? formatGradeDisplay(avg, activity.scoreFormats?.[j]) : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Failed / NA soldiers table */}
              {activity.failedSoldiers && activity.failedSoldiers.length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="text-sm font-semibold mb-2">
                    {getResultLabels(activity.displayConfiguration).skipped.label} / {getResultLabels(activity.displayConfiguration).na.label}
                  </h3>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b-2 border-border">
                        <th className="text-start px-3 py-2 font-semibold">חייל</th>
                        <th className="text-start px-3 py-2 font-semibold">כיתה</th>
                        <th className="text-start px-3 py-2 font-semibold">תוצאה</th>
                        <th className="text-start px-3 py-2 font-semibold">הערה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.failedSoldiers.map((s, i) => {
                        const labels = getResultLabels(activity.displayConfiguration);
                        const resultLabel = s.result === "skipped" ? labels.skipped.label : s.result === "na" ? labels.na.label : "נכשל";
                        return (
                          <tr key={i} className="border-b border-border">
                            <td className="px-3 py-2">{s.name}</td>
                            <td className="px-3 py-2">{s.squad}</td>
                            <td className={cn("px-3 py-2", s.result !== "na" && "text-destructive")}>{resultLabel}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.note ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {activity.rows.length === 0 && (
                <p className="text-sm text-muted-foreground">אין נתונים</p>
              )}
            </section>
          ))}
      </div>
    </div>
  );
}
