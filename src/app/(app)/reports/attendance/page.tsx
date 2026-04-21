"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { cn } from "@/lib/utils";
import type {
  AttendanceData,
  AttendanceStatus,
} from "@/app/api/reports/attendance/route";

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "נוכח",
  leave: "יציאה",
  medical_appointment: "תור רפואי",
  sick_day: "יום מחלה",
  inactive: "לא פעיל",
};

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: "bg-green-100 text-green-800",
  leave: "bg-amber-100 text-amber-800",
  medical_appointment: "bg-blue-100 text-blue-800",
  sick_day: "bg-pink-100 text-pink-800",
  inactive: "bg-muted text-muted-foreground",
};

export default function AttendancePage() {
  const router = useRouter();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    fetch(`/api/reports/attendance?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: AttendanceData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      const res = await fetch(`/api/reports/attendance/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-${data?.date || "report"}.pdf`;
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
        weekday: "long", day: "numeric", month: "long", year: "numeric",
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
          <h1 className="text-lg font-bold flex-1">דוח נוכחות</h1>
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
      <div className="p-4 space-y-6 pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Summary */}
            <div className="text-center">
              <p className="text-lg font-bold">
                נוכחים: <span className="text-green-600">{data.totalPresent}/{data.totalSoldiers}</span>
              </p>
            </div>

            {/* Platoons */}
            {data.platoons.map((platoon) => (
              <div key={platoon.platoonId}>
                {data.platoons.length > 1 && (
                  <div className="bg-foreground text-background px-3 py-2 rounded-lg mb-3 font-bold text-sm">
                    {platoon.companyName} — {platoon.platoonName}
                    <span className="font-normal text-xs ms-2">({platoon.presentCount}/{platoon.totalCount})</span>
                  </div>
                )}

                {platoon.squads.map((squad) => (
                  <div key={squad.id} className="mb-4">
                    <div className="text-xs font-semibold text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1">
                      {squad.name}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b-2 border-border">
                            <th className="text-start px-2 py-1.5 font-semibold">חייל</th>
                            <th className="text-start px-2 py-1.5 font-semibold">סטטוס</th>
                            <th className="text-start px-2 py-1.5 font-semibold">סיבה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {squad.soldiers.map((s) => (
                            <tr key={s.id} className="border-b border-border">
                              <td className="px-2 py-1.5">{s.name}</td>
                              <td className="px-2 py-1.5">
                                <span className={cn("inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded", STATUS_COLORS[s.status])}>
                                  {STATUS_LABELS[s.status]}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-xs text-muted-foreground">{s.reason ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
