"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Table2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useSession } from "next-auth/react";
import { effectiveRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
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
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsUrl, setSheetsUrl] = useState<string | null>(null);

  // Activity type filter state
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
  const [typesLoaded, setTypesLoaded] = useState(false);

  // Fetch activity types
  useEffect(() => {
    fetch("/api/activity-types")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((types: ActivityType[]) => {
        setActivityTypes(types);
        setSelectedTypeIds(new Set(types.map((t) => t.id)));
        setTypesLoaded(true);
      })
      .catch(() => {
        setTypesLoaded(true);
      });
  }, []);

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

  const allSelected = selectedTypeIds.size === activityTypes.length;
  const typesParam = allSelected ? "" : [...selectedTypeIds].join(",");

  function toggleType(id: string) {
    setSelectedTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't allow deselecting all
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedTypeIds(new Set(activityTypes.map((t) => t.id)));
  }

  async function handleSheetsExport() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }

    setSheetsLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId! });
      if (typesParam) params.set("activityTypeIds", typesParam);
      const res = await fetch(`/api/reports/all-activity/sheets?${params}`, {
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
    } catch {
      toast.error("שגיאה בהפקת הדוח");
    } finally {
      setSheetsLoading(false);
    }
  }

  function handleActivitySummary() {
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    const url = typesParam
      ? `/reports/activity-summary?types=${typesParam}`
      : "/reports/activity-summary";
    router.push(url);
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2">
        <h1 className="text-lg font-bold">דוחות</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Activity reports section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">דוחות פעילויות</h2>

          {/* Activity type filter chips */}
          {typesLoaded && activityTypes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAll}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  allSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                )}
              >
                {allSelected && <Check size={12} />}
                הכל
              </button>
              {activityTypes.map((type) => {
                const selected = selectedTypeIds.has(type.id);
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => toggleType(type.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {selected && <Check size={12} />}
                    {type.name}
                  </button>
                );
              })}
            </div>
          )}

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
              disabled={sheetsLoading}
              className="flex w-full items-start gap-4 rounded-xl border border-border bg-background p-4 text-start hover:bg-muted/50 transition-colors disabled:opacity-60"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {sheetsLoading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Table2 size={20} />
                )}
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
            {sheetsUrl && (
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
        </section>
      </div>
    </div>
  );
}
