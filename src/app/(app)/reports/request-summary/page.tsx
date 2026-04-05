"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { cn } from "@/lib/utils";
import {
  REQUEST_TYPE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/requests/constants";
import type { RequestSummaryData, RequestSummaryItem } from "@/app/api/reports/request-summary/route";
import type { RequestType, Transportation } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function RequestDetails({ req }: { req: RequestSummaryItem }) {
  const details: { label: string; value: string }[] = [];

  if (req.description) details.push({ label: "תיאור", value: req.description });

  if (req.type === "leave") {
    if (req.place) details.push({ label: "מקום", value: req.place });
    if (req.departureAt) details.push({ label: "יציאה", value: formatDateTime(req.departureAt) });
    if (req.returnAt) details.push({ label: "חזרה", value: formatDateTime(req.returnAt) });
    if (req.transportation) {
      details.push({ label: "הגעה", value: TRANSPORTATION_LABELS[req.transportation as Transportation] ?? req.transportation });
    }
  }

  if (req.type === "medical") {
    if (req.paramedicDate) details.push({ label: 'בדיקת חופ"ל', value: formatDate(req.paramedicDate) });
    if (req.appointmentDate) details.push({ label: "תור", value: formatDate(req.appointmentDate) });
    if (req.appointmentPlace) details.push({ label: "מקום", value: req.appointmentPlace });
    if (req.appointmentType) details.push({ label: "סוג", value: req.appointmentType });
    if (req.sickLeaveDays != null) details.push({ label: "ימי גימלים", value: String(req.sickLeaveDays) });
  }

  if (req.type === "hardship" && req.specialConditions != null) {
    details.push({ label: "אוכלוסיות מיוחדות", value: req.specialConditions ? "כן" : "לא" });
  }

  for (const n of req.notes ?? []) {
    const actionLabel = n.action === "approve" ? "אישור" : n.action === "deny" ? "דחיה" : n.action;
    details.push({ label: `${n.userName} (${actionLabel})`, value: n.note });
  }

  if (details.length === 0) return null;

  return (
    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      {details.map((d, i) => (
        <span key={i}>
          <span className="font-medium text-foreground/70">{d.label}:</span> {d.value}
        </span>
      ))}
    </div>
  );
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

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    if (typesParam) params.set("requestTypes", typesParam);
    if (dateRange) params.set("dateRange", dateRange);
    fetch(`/api/reports/request-summary?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: RequestSummaryData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId, typesParam, dateRange]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      if (typesParam) params.set("requestTypes", typesParam);
      if (dateRange) params.set("dateRange", dateRange);
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
            מחזור {data.cycleName} — {data.totalCount} בקשות מאושרות
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
            <p className="font-medium">אין בקשות מאושרות במחזור זה</p>
          </div>
        )}

        {!loading &&
          data?.groups.map((group, gi) => {
            if (group.level === "platoon") {
              return (
                <div
                  key={`p-${gi}`}
                  className="text-sm font-bold bg-muted rounded-lg px-3 py-2 mt-4"
                >
                  {group.label}
                </div>
              );
            }

            return (
              <div key={`s-${gi}`} className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground px-1">
                  {group.label}
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
