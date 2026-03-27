"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Table2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useSession } from "next-auth/react";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Report definitions
// ---------------------------------------------------------------------------

interface ReportDef {
  id: string;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  type: "pdf" | "sheets";
  href?: string;
}

const reports: ReportDef[] = [
  {
    id: "activity-summary",
    icon: FileText,
    titleKey: "activitySummary",
    descKey: "activitySummaryDesc",
    type: "pdf",
    href: "/reports/activity-summary",
  },
  {
    id: "all-activity",
    icon: Table2,
    titleKey: "allActivity",
    descKey: "allActivityDesc",
    type: "sheets",
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const router = useRouter();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const { data: session } = useSession();
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsUrl, setSheetsUrl] = useState<string | null>(null);

  // Check role — squad commanders should not reach here (nav hides it),
  // but guard against direct URL access
  const role = session?.user?.cycleAssignments
    ?.map((a) => effectiveRole(a.role as Role))
    .find((r) => r === "company_commander" || r === "platoon_commander");
  const isAdmin = session?.user?.isAdmin;
  const hasAccess = isAdmin || !!role;

  if (cycleLoading) return null;

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין גישה לדוחות</p>
        <p className="text-muted-foreground text-sm">דוחות אינם זמינים עבור מפקדי כיתות.</p>
      </div>
    );
  }

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
        <p className="text-muted-foreground text-sm">בחר מחזור פעיל כדי לצפות בדוחות.</p>
      </div>
    );
  }

  async function handleSheetsExport() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }

    setSheetsLoading(true);
    try {
      const res = await fetch(`/api/reports/all-activity/sheets?cycleId=${selectedCycleId}`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.needsAuth) {
        window.location.href = data.authUrl;
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Export failed");
      }

      setSheetsUrl(data.url);
    } catch (err) {
      toast.error("שגיאה בהפקת הדוח");
    } finally {
      setSheetsLoading(false);
    }
  }

  function handleReportClick(report: ReportDef) {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    if (report.type === "pdf" && report.href) {
      router.push(report.href);
    } else if (report.type === "sheets") {
      handleSheetsExport();
    }
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2">
        <h1 className="text-lg font-bold">דוחות</h1>
      </div>

      {/* Report cards */}
      <div className="p-4 space-y-3">
        {reports.map((report) => {
          const isLoading = report.type === "sheets" && sheetsLoading;
          return (
            <div key={report.id} className="space-y-2">
              <button
                type="button"
                onClick={() => handleReportClick(report)}
                disabled={isLoading}
                className="flex w-full items-start gap-4 rounded-xl border border-border bg-background p-4 text-start hover:bg-muted/50 transition-colors disabled:opacity-60"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {isLoading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <report.icon size={20} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">
                      {report.titleKey === "activitySummary" ? "סיכום פעילויות" : "כל הפעילויות"}
                    </p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {report.type === "pdf" ? "PDF" : "Sheets"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {report.descKey === "activitySummaryDesc"
                      ? "סיכום ציונים וביצועים לכל פעילות — גרף עוגה וטבלה לפי כיתות"
                      : "טבלת חיילים × פעילויות עם ציונים — גיליון Google Sheets לכל כיתה"}
                  </p>
                </div>
              </button>
              {report.type === "sheets" && sheetsUrl && (
                <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-2.5">
                  <a
                    href={sheetsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-green-800 underline underline-offset-2"
                  >
                    פתח את הדוח ב-Google Sheets
                  </a>
                  <button
                    type="button"
                    onClick={() => setSheetsUrl(null)}
                    className="text-green-600 hover:text-green-800 text-xs"
                  >
                    סגור
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
