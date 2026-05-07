"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown, FileUp, WifiOff, CheckSquare, X, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery, usePowerSync } from "@powersync/react";
import { useSyncReady } from "@/hooks/useSyncReady";
import { effectiveRole } from "@/lib/auth/permissions";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { activitiesTourSteps } from "@/lib/tour/steps";
import type { Role } from "@/types";
import { ActivityCard, type ActivitySummary } from "@/components/activities/ActivityCard";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { CreateActivityForm } from "@/components/activities/CreateActivityForm";
import { BulkImportActivitiesDialog } from "@/components/activities/BulkImportActivitiesDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterPill = "open" | "completed" | "future";
type SortMode = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const FILTER_LABELS: Record<FilterPill, string> = {
  open: "פתוחות",
  completed: "הושלמו",
  future: "עתידיות",
};
const FILTER_PILLS: FilterPill[] = ["open", "completed", "future"];

const SORT_LABELS: Record<SortMode, string> = {
  "date-desc": "תאריך (חדש לישן)",
  "date-asc": "תאריך (ישן לחדש)",
  "name-asc": "שם (א-ת)",
  "name-desc": "שם (ת-א)",
};

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const ACTIVITIES_QUERY = `
  SELECT
    a.id, a.name, a.date, a.status, a.is_required,
    at.name AS activity_type_name, at.icon AS activity_type_icon,
    p.id AS platoon_id, p.name AS platoon_name,
    c.name AS company_name
  FROM activities a
  JOIN activity_types at ON at.id = a.activity_type_id
  JOIN platoons p ON p.id = a.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE a.cycle_id = ?
  ORDER BY a.date DESC
`;

// Report counts as a single aggregation query with conditional sums,
// instead of 5 correlated subqueries per activity row.
// squad_id param: pass the squad's ID to scope counts to that squad,
// or '' to include all soldiers/reports in the platoon.
const REPORT_COUNTS_QUERY = `
  SELECT ar.activity_id,
    COUNT(*) AS reported_count,
    SUM(CASE WHEN ar.result = 'completed' AND ar.failed = 0 THEN 1 ELSE 0 END) AS completed_count,
    SUM(CASE WHEN ar.result = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
    SUM(CASE WHEN ar.failed = 1 THEN 1 ELSE 0 END) AS score_failed_count,
    SUM(CASE WHEN ar.result = 'na' THEN 1 ELSE 0 END) AS na_count
  FROM activity_reports ar
  JOIN activities a ON a.id = ar.activity_id
  JOIN soldiers s ON s.id = ar.soldier_id
  WHERE a.cycle_id = ?
    AND (? = '' OR s.squad_id = ?)
  GROUP BY ar.activity_id
`;

// Active soldier count per platoon as a single aggregation query,
// instead of a correlated subquery per activity row.
const SOLDIER_COUNTS_QUERY = `
  SELECT sq.platoon_id, COUNT(*) AS total_soldiers
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  WHERE s.status = 'active'
    AND s.cycle_id = ?
    AND (? = '' OR s.squad_id = ?)
  GROUP BY sq.platoon_id
`;

const COMPANY_PLATOONS_QUERY = `
  SELECT id, name FROM platoons WHERE company_id = ? ORDER BY sort_order ASC, name ASC
`;

// ---------------------------------------------------------------------------
// Data mapping
// ---------------------------------------------------------------------------

interface RawActivity {
  id: string; name: string; date: string;
  is_required: number;
  activity_type_name: string; activity_type_icon: string;
  platoon_id: string; platoon_name: string; company_name: string;
}

interface RawReportCounts {
  activity_id: string;
  reported_count: number;
  completed_count: number;
  skipped_count: number;
  score_failed_count: number;
  na_count: number;
}

interface RawSoldierCounts {
  platoon_id: string;
  total_soldiers: number;
}

function mapActivity(raw: RawActivity, reportCounts: RawReportCounts | undefined, totalSoldiers: number): ActivitySummary {
  const total = totalSoldiers;
  const reported = Number(reportCounts?.reported_count ?? 0);
  const completed = Number(reportCounts?.completed_count ?? 0);
  const skipped = Number(reportCounts?.skipped_count ?? 0);
  const failed = Number(reportCounts?.score_failed_count ?? 0);
  const na = Number(reportCounts?.na_count ?? 0);
  return {
    id: raw.id,
    name: raw.name,
    date: raw.date,
    isRequired: Number(raw.is_required) === 1,
    activityType: { name: raw.activity_type_name, icon: raw.activity_type_icon },
    platoon: { id: raw.platoon_id, name: raw.platoon_name, companyName: raw.company_name },
    counts: { completed, skipped, failed, na, missing: Math.max(0, total - reported), total },
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ActivitiesPage() {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawRole = selectedAssignment?.role ?? "";
  const role = rawRole ? effectiveRole(rawRole as Role) : "";
  const canCreate = role !== "squad_commander" && !!role;
  const canEdit = canCreate; // same roles that can create can also edit metadata
  const db = usePowerSync();

  // -------- Sticky header offset --------
  const actHeaderRef = useRef<HTMLDivElement>(null);
  const [actHeaderH, setActHeaderH] = useState(0);
  useEffect(() => {
    const el = actHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setActHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -------- PowerSync queries --------
  // Squad commanders see only their squad's counts; everyone else gets platoon-wide counts (squadId = '').
  const squadId = role === "squad_commander" ? (selectedAssignment?.unitId ?? "") : "";
  const cycleId = selectedCycleId ?? "";
  const activityParams = useMemo(() => [cycleId], [cycleId]);
  const countsParams = useMemo(() => [cycleId, squadId, squadId], [cycleId, squadId]);
  const { data: rawActivities, isLoading: activitiesLoading } = useQuery<RawActivity>(ACTIVITIES_QUERY, activityParams);
  const { data: rawReportCounts } = useQuery<RawReportCounts>(REPORT_COUNTS_QUERY, countsParams);
  const { data: rawSoldierCounts } = useQuery<RawSoldierCounts>(SOLDIER_COUNTS_QUERY, countsParams);
  const { showLoading, showConnectionError } = useSyncReady(
    (rawActivities ?? []).length > 0,
    activitiesLoading
  );

  const companyId = selectedAssignment?.unitType === "company" ? selectedAssignment.unitId : "";
  const platoonParams = useMemo(() => [companyId], [companyId]);
  const { data: companyPlatoons } = useQuery<{ id: string; name: string }>(
    COMPANY_PLATOONS_QUERY,
    platoonParams
  );

  const allActivities: ActivitySummary[] = useMemo(() => {
    const reportMap = new Map<string, RawReportCounts>();
    for (const rc of rawReportCounts ?? []) {
      reportMap.set(rc.activity_id, rc);
    }
    const soldierMap = new Map<string, number>();
    for (const sc of rawSoldierCounts ?? []) {
      soldierMap.set(sc.platoon_id, Number(sc.total_soldiers));
    }
    return (rawActivities ?? []).map((a) =>
      mapActivity(a, reportMap.get(a.id), soldierMap.get(a.platoon_id) ?? 0)
    );
  }, [rawActivities, rawReportCounts, rawSoldierCounts]);

  // -------- UI state --------
  // URL params take priority (deep links), then sessionStorage (back navigation), then default
  const [filter, setFilterRaw] = useState<FilterPill>(() => {
    const param = searchParams.get("filter");
    if (param && (FILTER_PILLS as readonly string[]).includes(param)) return param as FilterPill;
    if (typeof sessionStorage !== "undefined") {
      const saved = sessionStorage.getItem("activities:filter") as FilterPill | null;
      if (saved && (FILTER_PILLS as readonly string[]).includes(saved)) return saved;
    }
    return "open";
  });
  function setFilter(f: FilterPill) {
    setFilterRaw(f);
    sessionStorage.setItem("activities:filter", f);
  }

  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Multi-select
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiEditOpen, setMultiEditOpen] = useState(false);
  const [multiDeleteOpen, setMultiDeleteOpen] = useState(false);
  const [multiEditFields, setMultiEditFields] = useState<{ date?: boolean; isRequired?: boolean; name?: boolean; activityType?: boolean }>({});
  const [multiEditDate, setMultiEditDate] = useState("");
  const [multiEditIsRequired, setMultiEditIsRequired] = useState(true);
  const [multiEditName, setMultiEditName] = useState("");
  const [multiEditActivityTypeId, setMultiEditActivityTypeId] = useState("");
  const [multiSubmitting, setMultiSubmitting] = useState(false);

  // Activity types for edit dialog
  const [activityTypes, setActivityTypes] = useState<{ id: string; name: string; icon: string }[]>([]);
  useEffect(() => {
    if (multiEditOpen && activityTypes.length === 0) {
      fetch("/api/activity-types").then((r) => r.json()).then(setActivityTypes).catch(() => {});
    }
  }, [multiEditOpen]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitMultiSelect() {
    setMultiSelect(false);
    setSelectedIds(new Set());
  }

  async function handleMultiEdit() {
    if (selectedIds.size === 0) return;
    setMultiSubmitting(true);
    try {
      const updates: string[] = [];
      const values: unknown[] = [];
      if (multiEditFields.date && multiEditDate) {
        updates.push("date = ?");
        values.push(multiEditDate);
      }
      if (multiEditFields.isRequired !== undefined && multiEditFields.isRequired) {
        updates.push("is_required = ?");
        values.push(multiEditIsRequired ? 1 : 0);
      }
      if (multiEditFields.name && multiEditName.trim()) {
        updates.push("name = ?");
        values.push(multiEditName.trim());
      }
      if (multiEditFields.activityType && multiEditActivityTypeId) {
        updates.push("activity_type_id = ?");
        values.push(multiEditActivityTypeId);
      }
      if (updates.length === 0) { toast.error("לא נבחרו שדות לעדכון"); setMultiSubmitting(false); return; }

      await db.writeTransaction(async (tx) => {
        for (const id of selectedIds) {
          await tx.execute(`UPDATE activities SET ${updates.join(", ")} WHERE id = ?`, [...values, id]);
        }
      });
      toast.success(`${hebrewCount(selectedIds.size, "פעילות עודכנה", "פעילויות עודכנו")}`);
      setMultiEditOpen(false);
      exitMultiSelect();
    } catch (err) {
      console.error("[multi-edit]", err);
      toast.error("שגיאה בעדכון הפעילויות");
    } finally {
      setMultiSubmitting(false);
    }
  }

  async function handleMultiDelete() {
    setMultiSubmitting(true);
    try {
      await db.writeTransaction(async (tx) => {
        for (const id of selectedIds) {
          await tx.execute("DELETE FROM activity_reports WHERE activity_id = ?", [id]);
          await tx.execute("DELETE FROM activities WHERE id = ?", [id]);
        }
      });
      toast.success(`${hebrewCount(selectedIds.size, "פעילות נמחקה", "פעילויות נמחקו")}`);
      setMultiDeleteOpen(false);
      exitMultiSelect();
    } catch {
      toast.error("שגיאה במחיקת הפעילויות");
    } finally {
      setMultiSubmitting(false);
    }
  }

  const todayStr = new Date().toISOString().split("T")[0];

  // An activity is "completed" when its date is in the past and it has no gaps.
  // Non-required activities can't have gaps, so past date alone is sufficient.
  const isCompleted = (a: ActivitySummary) => {
    const isPast = a.date.split("T")[0] < todayStr;
    if (!isPast) return false;
    if (a.isRequired && (a.counts.missing > 0 || a.counts.skipped > 0 || a.counts.failed > 0)) return false;
    return true;
  };

  const filtered = useMemo(() => {
    let list = [...allActivities];
    if (filter === "open") {
      // Open = date < tomorrow with gaps (non-completed past/today activities)
      list = list.filter((a) => a.date.split("T")[0] <= todayStr && !isCompleted(a));
    } else if (filter === "completed") {
      list = list.filter(isCompleted);
    } else if (filter === "future") {
      list = list.filter((a) => a.date.split("T")[0] > todayStr);
    }
    list.sort((a, b) => {
      if (sortMode === "date-desc") return b.date.localeCompare(a.date);
      if (sortMode === "date-asc") return a.date.localeCompare(b.date);
      if (sortMode === "name-asc") return a.name.localeCompare(b.name, "he");
      if (sortMode === "name-desc") return b.name.localeCompare(a.name, "he");
      return 0;
    });
    return list;
  }, [allActivities, filter, sortMode, todayStr]);

  const showPlatoon = role === "company_commander" || rawRole === "instructor";

  // Group activities by platoon for company-level roles
  const activitiesByPlatoon = useMemo(() => {
    if (!showPlatoon) return null;
    const platoonOrder = (companyPlatoons ?? []).map((p) => p.id);
    const map = new Map<string, { platoonName: string; activities: ActivitySummary[] }>();
    for (const activity of filtered) {
      const pid = activity.platoon.id;
      if (!map.has(pid)) {
        map.set(pid, { platoonName: activity.platoon.name, activities: [] });
      }
      map.get(pid)!.activities.push(activity);
    }
    // Sort platoon groups by the sort_order from the COMPANY_PLATOONS_QUERY
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        const ai = platoonOrder.indexOf(a);
        const bi = platoonOrder.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([, group]) => group);
  }, [filtered, role, companyPlatoons]);

  const platoonOptions = useMemo(() => {
    if (!selectedAssignment) return [];
    if (role === "platoon_commander") return [{ id: selectedAssignment.unitId, name: "המחלקה שלי" }];
    if (role === "company_commander" || rawRole === "instructor") return companyPlatoons ?? [];
    return [];
  }, [selectedAssignment, role, rawRole, companyPlatoons]);

  function handleCreateSuccess(_activityId: string, platoonCount: number) {
    setCreateOpen(false);
    if (platoonCount > 1) {
      toast.success(`הפעילות נוצרה בהצלחה ב-${hebrewCount(platoonCount, "מחלקה", "מחלקות")}`);
    } else {
      toast.success("הפעילות נוצרה בהצלחה");
    }
  }

  function handleBulkSuccess(created: number, skipped: number) {
    setBulkOpen(false);
    const parts = [`${hebrewCount(created, "פעילות יובאה", "פעילויות יובאו")} בהצלחה`];
    if (skipped > 0) parts.push(`(${skipped} דולגו — כבר קיימות)`);
    toast.success(parts.join(" "));
  }

  // -------- Context menu --------
  const [contextMenu, setContextMenu] = useState<{ activity: ActivitySummary; position: { x: number; y: number } } | null>(null);

  const openContextMenu = useCallback((activity: ActivitySummary, position: { x: number; y: number }) => {
    setContextMenu({ activity, position });
  }, []);

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const a = contextMenu.activity;
    return [
      {
        label: a.isRequired ? "סמן כרשות" : "סמן כחובה",
        onClick: () => { db.execute("UPDATE activities SET is_required = ? WHERE id = ?", [a.isRequired ? 0 : 1, a.id]); },
      },
    ];
  }, [contextMenu, db]);

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "activities", steps: activitiesTourSteps });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  if (rawRole === "company_medic" || rawRole === "hardship_coordinator") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין גישה לעמוד זה</p>
        <p className="text-muted-foreground text-sm">עמוד הפעילויות אינו זמין עבור תפקיד זה.</p>
      </div>
    );
  }

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
        <p className="text-muted-foreground text-sm">בחר מחזור פעיל כדי לצפות בפעילויות.</p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div ref={actHeaderRef} className="sticky z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2" style={{ top: "var(--app-header-height, 0px)" }}>
        <div className="flex items-center gap-2">
          <div data-tour="activities-filters" className="flex gap-1.5 overflow-x-auto pb-1 min-w-0 flex-1">
            {FILTER_PILLS.map((f) => (
              <button
                key={f} type="button" onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
          <div data-tour="activities-sort" className="relative shrink-0">
            <button
              type="button" onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              מיין <ChevronDown size={12} />
            </button>
            {sortOpen && (
              <div className="absolute end-0 top-full mt-1 z-30 min-w-[160px] rounded-lg border border-border bg-background shadow-md">
                {(Object.entries(SORT_LABELS) as [SortMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode} type="button"
                    onClick={() => { setSortMode(mode); setSortOpen(false); }}
                    className={cn(
                      "flex w-full items-center px-3 py-2 text-xs text-start hover:bg-muted transition-colors",
                      sortMode === mode && "font-semibold text-primary"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {canEdit && !multiSelect && (
            <button
              type="button"
              data-tour="activities-multiselect-btn"
              onClick={() => setMultiSelect(true)}
              className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="בחירה מרובה"
            >
              <CheckSquare size={16} />
            </button>
          )}
          {multiSelect && (
            <>
              <button
                type="button"
                onClick={exitMultiSelect}
                className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="ביטול בחירה"
              >
                <X size={16} />
              </button>
              <span className="hidden md:inline text-xs text-muted-foreground">
                {selectedIds.size === 0 ? "בחר פעילויות" : hebrewCount(selectedIds.size, "פעילות נבחרה", "פעילויות נבחרו")}
              </span>
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  setMultiEditFields({});
                  setMultiEditDate(new Date().toISOString().split("T")[0]);
                  setMultiEditIsRequired(true);
                  setMultiEditName("");
                  setMultiEditActivityTypeId("");
                  setMultiEditOpen(true);
                }}
                className="hidden md:flex items-center gap-1.5 shrink-0 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                <Pencil size={14} />
                ערוך
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => setMultiDeleteOpen(true)}
                className="hidden md:flex items-center gap-1.5 shrink-0 rounded-md border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
              >
                <Trash2 size={14} />
                מחק
              </button>
            </>
          )}
          {canCreate && !multiSelect && (
            <>
              <button
                data-tour="activities-import-btn"
                type="button" onClick={() => setBulkOpen(true)}
                className="hidden md:flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors shrink-0"
              >
                <FileUp size={15} /> ייבוא
              </button>
              <button
                data-tour="activities-add-btn"
                type="button" onClick={() => setCreateOpen(true)}
                className="hidden md:flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
              >
                <Plus size={15} /> הוסף פעילות
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="pb-32">
        {filtered.length === 0 && showLoading && filter === "open" && (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            ))}
          </div>
        )}
        {filtered.length === 0 && showConnectionError && filter === "open" && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
            <p className="font-medium">לא ניתן לטעון נתונים</p>
            <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
          </div>
        )}
        {filtered.length === 0 && !showLoading && !showConnectionError && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין פעילויות</p>
            {filter !== "open" && <p className="text-sm text-muted-foreground">נסה לשנות את הסינון</p>}
            {filter === "open" && canCreate && <p className="text-sm text-muted-foreground">לחץ על + כדי ליצור פעילות חדשה</p>}
          </div>
        )}
        {filtered.length > 0 && activitiesByPlatoon && (
          <div>
            {activitiesByPlatoon.map((platoonGroup, pi) => (
              <div key={platoonGroup.platoonName}>
                <div className="sticky z-10 bg-muted/80 backdrop-blur-sm px-4 py-2 flex items-center justify-between border-b border-border" style={{ top: `calc(var(--app-header-height, 0px) + ${actHeaderH}px)` }}>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {platoonGroup.platoonName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {platoonGroup.activities.length}
                  </span>
                </div>
                {platoonGroup.activities.map((activity, ai) => (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    showPlatoon={false}
                    onClick={() => router.push(`/activities/${activity.id}`)}
                    onLongPress={canEdit && !multiSelect ? (pos) => openContextMenu(activity, pos) : undefined}
                    dataTour={pi === 0 && ai === 0 ? "activities-card" : undefined}
                    selectable={multiSelect}
                    selected={selectedIds.has(activity.id)}
                    onToggleSelect={() => toggleSelect(activity.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {filtered.length > 0 && !activitiesByPlatoon && (
          <div>
            {filtered.map((activity, i) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                showPlatoon={showPlatoon}
                onClick={() => router.push(`/activities/${activity.id}`)}
                onLongPress={canEdit && !multiSelect ? (pos) => openContextMenu(activity, pos) : undefined}
                dataTour={i === 0 ? "activities-card" : undefined}
                selectable={multiSelect}
                selected={selectedIds.has(activity.id)}
                onToggleSelect={() => toggleSelect(activity.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile FABs */}
      {canCreate && !multiSelect && (
        <>
          <button
            data-tour="activities-import-btn"
            type="button" onClick={() => setBulkOpen(true)}
            className="md:hidden fixed bottom-20 end-20 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg transition-transform active:scale-95"
            aria-label="ייבוא פעילויות"
          >
            <FileUp size={20} />
          </button>
          <button
            data-tour="activities-add-btn"
            type="button" onClick={() => setCreateOpen(true)}
            className="md:hidden fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
            aria-label="הוסף פעילות"
          >
            <Plus size={24} />
          </button>
        </>
      )}

      {canCreate && selectedCycleId && platoonOptions.length > 0 && (
        <BulkImportActivitiesDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          cycleId={selectedCycleId}
          platoonOptions={platoonOptions}
          onSuccess={handleBulkSuccess}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>הוסף פעילות</DialogTitle></DialogHeader>
          {selectedCycleId && platoonOptions.length > 0 && (
            <CreateActivityForm
              cycleId={selectedCycleId}
              platoonOptions={platoonOptions}
              onSuccess={handleCreateSuccess}
              onCancel={() => setCreateOpen(false)}
            />
          )}
          {selectedCycleId && platoonOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">לא נמצאו מחלקות זמינות</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Multi-select FABs — replace create/import FABs */}
      {multiSelect && (
        <>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setMultiDeleteOpen(true)}
            className="fixed bottom-20 end-20 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-40 md:hidden"
            aria-label="מחק נבחרים"
          >
            <Trash2 size={20} />
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => {
              setMultiEditFields({});
              setMultiEditDate(new Date().toISOString().split("T")[0]);
              setMultiEditIsRequired(true);
              setMultiEditName("");
              setMultiEditOpen(true);
            }}
            className="fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-40 md:hidden"
            aria-label="ערוך נבחרים"
          >
            <Pencil size={24} />
          </button>
        </>
      )}

      {/* Multi-edit dialog */}
      <Dialog open={multiEditOpen} onOpenChange={setMultiEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת {hebrewCount(selectedIds.size, "פעילות", "פעילויות")}</DialogTitle>
            <DialogDescription>בחר את השדות לעדכון</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Activity type field */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!multiEditFields.activityType}
                  onChange={(e) => setMultiEditFields((f) => ({ ...f, activityType: e.target.checked }))}
                  className="rounded"
                />
                <Label>סוג פעילות</Label>
              </div>
              {multiEditFields.activityType && (
                <select
                  value={multiEditActivityTypeId}
                  onChange={(e) => setMultiEditActivityTypeId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">בחר סוג</option>
                  {activityTypes.map((at) => (
                    <option key={at.id} value={at.id}>{at.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Name field */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!multiEditFields.name}
                  onChange={(e) => setMultiEditFields((f) => ({ ...f, name: e.target.checked }))}
                  className="rounded"
                />
                <Label>שם</Label>
              </div>
              {multiEditFields.name && (
                <Input
                  value={multiEditName}
                  onChange={(e) => setMultiEditName(e.target.value)}
                  placeholder="שם הפעילות"
                />
              )}
            </div>

            {/* Date field */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!multiEditFields.date}
                  onChange={(e) => setMultiEditFields((f) => ({ ...f, date: e.target.checked }))}
                  className="rounded"
                />
                <Label>תאריך</Label>
              </div>
              {multiEditFields.date && (
                <Input
                  type="date"
                  value={multiEditDate}
                  onChange={(e) => setMultiEditDate(e.target.value)}
                  dir="ltr"
                  lang="he"
                />
              )}
            </div>

            {/* Required toggle */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!multiEditFields.isRequired}
                  onChange={(e) => setMultiEditFields((f) => ({ ...f, isRequired: e.target.checked }))}
                  className="rounded"
                />
                <Label>חובה/רשות</Label>
              </div>
              {multiEditFields.isRequired && (
                <div className="flex items-center gap-2">
                  <Switch checked={multiEditIsRequired} onCheckedChange={setMultiEditIsRequired} />
                  <span className="text-sm">{multiEditIsRequired ? "חובה" : "רשות"}</span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMultiEditOpen(false)}>ביטול</Button>
            <Button onClick={handleMultiEdit} disabled={multiSubmitting}>
              {multiSubmitting ? "מעדכן..." : "עדכן"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Multi-delete confirmation */}
      <AlertDialog open={multiDeleteOpen} onOpenChange={setMultiDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת פעילויות</AlertDialogTitle>
            <AlertDialogDescription>
              האם למחוק {hebrewCount(selectedIds.size, "פעילות", "פעילויות")}? פעולה זו תמחק גם את כל הדיווחים המשויכים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMultiDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={multiSubmitting}
            >
              {multiSubmitting ? "מוחק..." : "מחק"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
