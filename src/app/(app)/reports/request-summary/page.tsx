"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import {
  REQUEST_TYPE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/requests/constants";
import { formatAppointment } from "@/lib/requests/medical-appointments";
import { extractRequestFields, formatNotes } from "@/lib/reports/detail-columns";
import { RequestDetailColumns } from "@/components/reports/RequestDetailColumns";
import type { RequestSummaryData, RequestSummaryItem, RequestStatusFilter } from "@/app/api/reports/request-summary/route";

const STATUS_FILTER_LABELS: Record<RequestStatusFilter, string> = {
  open_active: "פתוחות ופעילות",
  open: "פתוחות",
  active: "פעילות",
  approved: "מאושרות",
  all: "הכל",
};
import type { RequestType, Transportation } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const clientFormatters = {
  text: (s: string) => s,
  dateTime: formatDateTime,
  date: formatDate,
  appointment: formatAppointment,
  transportationLabels: TRANSPORTATION_LABELS as Record<string, string>,
};

function RequestDetails({ req }: { req: RequestSummaryItem }) {
  const { fields, appointments } = extractRequestFields(req, clientFormatters);

  const notes = formatNotes(req.notes ?? []);

  return <RequestDetailColumns data={{ fields, appointments, notes }} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RequestSummaryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<RequestSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  const typesParam = searchParams.get("types") ?? "";
  const dateRange = searchParams.get("dateRange") ?? "";
  const statusFilter = (searchParams.get("statusFilter") ?? "open_active") as RequestStatusFilter;

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    if (typesParam) params.set("requestTypes", typesParam);
    if (dateRange) params.set("dateRange", dateRange);
    if (statusFilter) params.set("statusFilter", statusFilter);
    fetch(`/api/reports/request-summary?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: RequestSummaryData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId, typesParam, dateRange, statusFilter]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      if (typesParam) params.set("requestTypes", typesParam);
      if (dateRange) params.set("dateRange", dateRange);
      if (statusFilter) params.set("statusFilter", statusFilter);
      const res = await fetch(`/api/reports/request-summary/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `request-summary-${data?.cycleName || "report"}.pdf`;
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
          <h1 className="text-lg font-bold flex-1">דוח בקשות</h1>
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
            מחזור {data.cycleName} — {STATUS_FILTER_LABELS[statusFilter]} · {data.totalCount} בקשות
            {dateRange === "week" && " · שבוע אחרון"}
            {dateRange === "month" && " · חודש אחרון"}
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

        {!loading && data && data.totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין בקשות במחזור זה</p>
          </div>
        )}

        {!loading &&
          data?.groups.map((group, gi) => {
            if (group.level === "platoon") {
              // Count requests in all squad groups under this platoon header
              let platoonCount = 0;
              for (let j = gi + 1; j < data.groups.length && data.groups[j].level === "squad"; j++) {
                platoonCount += data.groups[j].requests.length;
              }
              return (
                <div
                  key={`p-${gi}`}
                  className="flex items-center justify-between text-sm font-bold bg-muted rounded-lg px-3 py-2 mt-4"
                >
                  <span>{group.label}</span>
                  <span className="text-xs font-medium text-muted-foreground">{platoonCount}</span>
                </div>
              );
            }

            return (
              <div key={`s-${gi}`} className="space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-1">
                  <span>{group.label}</span>
                  <span>{group.requests.length}</span>
                </div>
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  {group.requests.map((req) => (
                    <div key={req.id} className="px-4 py-3">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="text-xs font-medium bg-muted rounded px-1.5 py-0.5">
                          {REQUEST_TYPE_LABELS[req.type as RequestType]}
                        </span>
                        <span className="text-sm font-semibold">{req.soldierName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(req.createdAt)}
                        </span>
                      </div>
                      <RequestDetails req={req} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
