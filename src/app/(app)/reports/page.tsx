"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Table2, ClipboardList, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useSession } from "next-auth/react";
import { effectiveRole } from "@/lib/auth/permissions";
import { SheetsExportDialog } from "@/components/reports/SheetsExportDialog";
import type { Role } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityType {
  id: string;
  name: string;
  icon: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const router = useRouter();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const { data: session } = useSession();
  const [sheetsDialogOpen, setSheetsDialogOpen] = useState(false);

  // Activity type filter state — "" means all types
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [typesLoaded, setTypesLoaded] = useState(false);
  // Date range filter — "" means all, "week" = last 7 days, "month" = last 30 days
  const [activityDateRange, setActivityDateRange] = useState<string>("");

  // Request type filter state — "" means all types
  const [selectedRequestType, setSelectedRequestType] = useState<string>("");
  const [requestDateRange, setRequestDateRange] = useState<string>("");
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>("open_active");

  // Fetch activity types
  useEffect(() => {
    fetch("/api/activity-types")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((types: ActivityType[]) => {
        setActivityTypes(types);
        setTypesLoaded(true);
      })
      .catch(() => {
        setTypesLoaded(true);
      });
  }, []);

  // Check role — squad commanders should not reach here (nav hides it),
  // but guard against direct URL access
  const assignments = session?.user?.cycleAssignments ?? [];
  const role = assignments
    .map((a) => effectiveRole(a.role as Role))
    .find((r) => r === "company_commander" || r === "platoon_commander");
  const rawRoles = assignments.map((a) => a.role as Role);
  const isInstructor = rawRoles.includes("instructor");
  const isMedic = rawRoles.includes("company_medic");
  const isAdmin = session?.user?.isAdmin;
  const hasAccess = isAdmin || !!role || isInstructor || isMedic;
  const showActivityReports = !isMedic;
  const showRequestReports = !isInstructor;
  const showDailyForum = !!role; // platoon or company commander only

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

  // "" = all types, otherwise a single type ID
  const typesParam = selectedTypeId;

  function handleSheetsExport() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    setSheetsDialogOpen(true);
  }

  function handleActivitySummary() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    const params = new URLSearchParams();
    if (typesParam) params.set("types", typesParam);
    if (activityDateRange) params.set("dateRange", activityDateRange);
    const qs = params.toString();
    router.push(`/reports/activity-summary${qs ? `?${qs}` : ""}`);
  }

  function handleDailyForum() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    router.push("/reports/daily-forum");
  }

  function handleRequestSummary() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    const params = new URLSearchParams();
    const reqType = isMedic ? "medical" : selectedRequestType;
    if (reqType) params.set("types", reqType);
    if (requestDateRange) params.set("dateRange", requestDateRange);
    if (requestStatusFilter) params.set("statusFilter", requestStatusFilter);
    const qs = params.toString();
    router.push(`/reports/request-summary${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2">
        <h1 className="text-lg font-bold">דוחות</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Daily forum report */}
        {showDailyForum && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">דוח יומי</h2>
          <button
            type="button"
            onClick={handleDailyForum}
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-background p-4 text-start hover:bg-muted/50 transition-colors"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Calendar size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">דוח פורום יומי</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  PDF
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                סיכום יומי של בקשות פתוחות ופעילות, פעילויות היום והמחר, ופערים
              </p>
            </div>
          </button>
        </section>
        )}

        {/* Activity reports section */}
        {showActivityReports && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">דוחות פעילויות</h2>

          {/* Activity filters */}
          <div className="flex flex-wrap gap-2">
            {typesLoaded && activityTypes.length > 1 && (
              <select
                value={selectedTypeId}
                onChange={(e) => setSelectedTypeId(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">כל סוגי הפעילויות</option>
                {activityTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={activityDateRange}
              onChange={(e) => setActivityDateRange(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">כל התאריכים</option>
              <option value="week">שבוע אחרון</option>
              <option value="month">חודש אחרון</option>
            </select>
          </div>

          {/* Activity Summary report card */}
          <button
            type="button"
            onClick={handleActivitySummary}
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-background p-4 text-start hover:bg-muted/50 transition-colors"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">סיכום פעילויות</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  PDF
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                סיכום ציונים וביצועים לכל פעילות — גרף עוגה וטבלה לפי כיתות
              </p>
            </div>
          </button>

          {/* All Activity report card */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleSheetsExport}
              className="flex w-full items-start gap-4 rounded-xl border border-border bg-background p-4 text-start hover:bg-muted/50 transition-colors"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Table2 size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">כל הפעילויות</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Sheets
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  טבלת חיילים × פעילויות עם ציונים — גיליון Google Sheets לכל כיתה
                </p>
              </div>
            </button>
          </div>
        </section>
        )}

        {/* Sheets export dialog */}
        {selectedCycleId && (
          <SheetsExportDialog
            open={sheetsDialogOpen}
            onOpenChange={setSheetsDialogOpen}
            cycleId={selectedCycleId}
            activityTypeIds={typesParam || undefined}
            dateRange={activityDateRange || undefined}
          />
        )}

        {/* Request reports section */}
        {showRequestReports && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">דוחות בקשות</h2>

          {/* Request filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={requestStatusFilter}
              onChange={(e) => setRequestStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="open_active">פתוחות ופעילות</option>
              <option value="open">פתוחות</option>
              <option value="active">פעילות</option>
              <option value="approved">מאושרות</option>
              <option value="all">הכל</option>
            </select>
            {!isMedic && (
            <select
              value={selectedRequestType}
              onChange={(e) => setSelectedRequestType(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">כל סוגי הבקשות</option>
              <option value="leave">בקשת יציאה</option>
              <option value="medical">רפואה</option>
              <option value="hardship">בקשת ת&quot;ש</option>
            </select>
            )}
            <select
              value={requestDateRange}
              onChange={(e) => setRequestDateRange(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">כל התאריכים</option>
              <option value="week">שבוע אחרון</option>
              <option value="month">חודש אחרון</option>
            </select>
          </div>

          {/* Request Summary report card */}
          <button
            type="button"
            onClick={handleRequestSummary}
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-background p-4 text-start hover:bg-muted/50 transition-colors"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ClipboardList size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">סיכום בקשות</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  PDF
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                בקשות לפי סטטוס וחייל — מקובצות לפי כיתות ומחלקות
              </p>
            </div>
          </button>
        </section>
        )}
      </div>
    </div>
  );
}
