"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import type {
  HomeVisitReportData,
  HomeVisitEntry,
} from "@/app/api/reports/home-visit-report/route";

const HOME_VISIT_STATUS_LABELS: Record<string, string> = {
  in_order: "תקין",
  deficiencies: "ליקויים",
};

function formatHebrewDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const label = HOME_VISIT_STATUS_LABELS[status] ?? status;
  const cls =
    status === "in_order"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function VisitsCell({ visits }: { visits: HomeVisitEntry[] }) {
  if (visits.length === 0) {
    return <span className="text-xs italic text-muted-foreground">לא בוצע</span>;
  }
  return (
    <div className="space-y-1.5">
      {visits.map((v, idx) => (
        <div key={idx}>
          <div className="flex items-center gap-2 text-xs">
            <span>{formatHebrewDate(v.date)}</span>
            <StatusBadge status={v.status} />
          </div>
          {v.notes && (
            <div className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
              {v.notes}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HomeVisitReportPage() {
  const router = useRouter();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<HomeVisitReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    fetch(`/api/reports/home-visit-report?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: HomeVisitReportData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      const res = await fetch(`/api/reports/home-visit-report/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().split("T")[0];
      a.download = `home-visits-${today}.pdf`;
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
          <h1 className="text-lg font-bold flex-1">דוח ביקורי בית</h1>
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
          <p className="text-xs text-muted-foreground mt-1">מחזור {data.cycleName}</p>
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
                בוצעו ביקורי בית:{" "}
                <span className="text-green-600">
                  {data.totalVisited}/{data.totalSoldiers}
                </span>
              </p>
            </div>

            {/* Platoons */}
            {data.platoons.map((platoon) => (
              <div key={platoon.platoonId}>
                {data.platoons.length > 1 && (
                  <div className="bg-foreground text-background px-3 py-2 rounded-lg mb-3 font-bold text-sm">
                    {platoon.companyName} — {platoon.platoonName}
                    <span className="font-normal text-xs ms-2">
                      ({platoon.visitedCount}/{platoon.totalCount})
                    </span>
                  </div>
                )}

                {platoon.squads.map((squad) => (
                  <div key={squad.id} className="mb-4">
                    <div className="text-xs font-semibold text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1">
                      {squad.name}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-border">
                          <th className="text-start py-1.5 px-2 font-semibold w-1/3">חייל</th>
                          <th className="text-start py-1.5 px-2 font-semibold">ביקורי בית</th>
                        </tr>
                      </thead>
                      <tbody>
                        {squad.soldiers.map((s) => (
                          <tr key={s.id} className="border-b border-border align-top">
                            <td className="py-2 px-2 font-medium">{s.name}</td>
                            <td className="py-2 px-2">
                              <VisitsCell visits={s.visits} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
