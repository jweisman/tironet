"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown, FileUp, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery, usePowerSync } from "@powersync/react";
import { useSyncReady } from "@/hooks/useSyncReady";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";
import { ActivityCard, type ActivitySummary } from "@/components/activities/ActivityCard";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { CreateActivityForm } from "@/components/activities/CreateActivityForm";
import { BulkImportActivitiesDialog } from "@/components/activities/BulkImportActivitiesDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterPill = "open" | "completed" | "gaps" | "future";
type SortMode = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const FILTER_LABELS: Record<FilterPill, string> = {
  open: "פתוחות",
  completed: "הושלמו",
  gaps: "עם פערים",
  future: "עתידיות",
};
const FILTER_PILLS: FilterPill[] = ["open", "completed", "gaps", "future"];

const SORT_LABELS: Record<SortMode, string> = {
  "date-desc": "תאריך (חדש לישן)",
  "date-asc": "תאריך (ישן לחדש)",
  "name-asc": "שם (א-ת)",
  "name-desc": "שם (ת-א)",
};

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

// squad_id param: pass the squad's ID to scope counts to that squad,
// or '' to include all soldiers/reports in the platoon (for platoon/company/admin roles).
const ACTIVITIES_QUERY = `
  WITH sf AS (SELECT ? AS squad_id)
  SELECT
    a.id, a.name, a.date, a.status, a.is_required,
    at.name AS activity_type_name, at.icon AS activity_type_icon,
    p.id AS platoon_id, p.name AS platoon_name,
    c.name AS company_name,
    (
      SELECT COUNT(*) FROM soldiers s
      JOIN squads sq ON sq.id = s.squad_id
      WHERE sq.platoon_id = a.platoon_id
        AND s.status = 'active' AND s.cycle_id = a.cycle_id
        AND ((SELECT squad_id FROM sf) = '' OR s.squad_id = (SELECT squad_id FROM sf))
    ) AS total_soldiers,
    (SELECT COUNT(*) FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id AND ar.result = 'passed'
     AND ((SELECT squad_id FROM sf) = '' OR s.squad_id = (SELECT squad_id FROM sf))) AS passed_count,
    (SELECT COUNT(*) FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id AND ar.result = 'failed'
     AND ((SELECT squad_id FROM sf) = '' OR s.squad_id = (SELECT squad_id FROM sf))) AS failed_count,
    (SELECT COUNT(*) FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id AND ar.result = 'na'
     AND ((SELECT squad_id FROM sf) = '' OR s.squad_id = (SELECT squad_id FROM sf))) AS na_count,
    (SELECT COUNT(*) FROM activity_reports ar
     JOIN soldiers s ON s.id = ar.soldier_id
     WHERE ar.activity_id = a.id
     AND ((SELECT squad_id FROM sf) = '' OR s.squad_id = (SELECT squad_id FROM sf))) AS reported_count
  FROM activities a
  JOIN activity_types at ON at.id = a.activity_type_id
  JOIN platoons p ON p.id = a.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE a.cycle_id = ?
  ORDER BY a.date DESC
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
  total_soldiers: number;
  passed_count: number; failed_count: number; na_count: number; reported_count: number;
}

function mapActivity(raw: RawActivity): ActivitySummary {
  const reported = Number(raw.reported_count ?? 0);
  const total = Number(raw.total_soldiers ?? 0);
  return {
    id: raw.id,
    name: raw.name,
    date: raw.date,
    isRequired: Number(raw.is_required) === 1,
    activityType: { name: raw.activity_type_name, icon: raw.activity_type_icon },
    platoon: { id: raw.platoon_id, name: raw.platoon_name, companyName: raw.company_name },
    passedCount: Number(raw.passed_count ?? 0),
    failedCount: Number(raw.failed_count ?? 0),
    naCount: Number(raw.na_count ?? 0),
    missingCount: Math.max(0, total - reported),
    totalSoldiers: total,
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
  const queryParams = useMemo(() => [squadId, selectedCycleId ?? ""], [squadId, selectedCycleId]);
  const { data: rawActivities, isLoading: activitiesLoading } = useQuery<RawActivity>(ACTIVITIES_QUERY, queryParams);
  const { showLoading, showEmpty, showConnectionError } = useSyncReady(
    (rawActivities ?? []).length > 0,
    activitiesLoading
  );

  const companyId = selectedAssignment?.unitType === "company" ? selectedAssignment.unitId : "";
  const platoonParams = useMemo(() => [companyId], [companyId]);
  const { data: companyPlatoons } = useQuery<{ id: string; name: string }>(
    COMPANY_PLATOONS_QUERY,
    platoonParams
  );

  const allActivities: ActivitySummary[] = useMemo(
    () => (rawActivities ?? []).map(mapActivity),
    [rawActivities]
  );

  // -------- UI state --------
  const initialFilter = (searchParams.get("filter") as FilterPill | null) ?? "open";
  const [filter, setFilter] = useState<FilterPill>(
    (FILTER_PILLS as readonly string[]).includes(initialFilter) ? initialFilter as FilterPill : "open"
  );
  const [sortMode, setSortMode] = useState<SortMode>("date-asc");
  const [sortOpen, setSortOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];

  // An activity is "completed" when its date is in the past and it has no gaps.
  // Non-required activities can't have gaps, so past date alone is sufficient.
  const isCompleted = (a: ActivitySummary) => {
    const isPast = a.date.split("T")[0] < todayStr;
    if (!isPast) return false;
    if (a.isRequired && (a.missingCount > 0 || a.failedCount > 0)) return false;
    return true;
  };

  const filtered = useMemo(() => {
    let list = [...allActivities];
    if (filter === "open") {
      // Open = date < tomorrow with gaps (non-completed past/today activities)
      list = list.filter((a) => a.date.split("T")[0] <= todayStr && !isCompleted(a));
    } else if (filter === "completed") {
      list = list.filter(isCompleted);
    } else if (filter === "gaps") {
      list = list.filter((a) => a.isRequired && a.date.split("T")[0] < todayStr && (a.missingCount > 0 || a.failedCount > 0));
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
      toast.success(`הפעילות נוצרה בהצלחה ב-${platoonCount} מחלקות`);
    } else {
      toast.success("הפעילות נוצרה בהצלחה");
    }
  }

  function handleBulkSuccess(created: number, skipped: number) {
    setBulkOpen(false);
    const parts = [`${created} פעילויות יובאו בהצלחה`];
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

  if (rawRole === "company_medic") {
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
          <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
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
          <div className="relative shrink-0">
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
          {canCreate && (
            <>
              <button
                type="button" onClick={() => setBulkOpen(true)}
                className="hidden md:flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors shrink-0"
              >
                <FileUp size={15} /> ייבוא
              </button>
              <button
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
        {filtered.length === 0 && (showEmpty || filter !== "open") && !showLoading && !showConnectionError && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין פעילויות</p>
            {filter !== "open" && <p className="text-sm text-muted-foreground">נסה לשנות את הסינון</p>}
            {filter === "open" && canCreate && <p className="text-sm text-muted-foreground">לחץ על + כדי ליצור פעילות חדשה</p>}
          </div>
        )}
        {filtered.length > 0 && activitiesByPlatoon && (
          <div>
            {activitiesByPlatoon.map((platoonGroup) => (
              <div key={platoonGroup.platoonName}>
                <div className="sticky z-10 bg-muted/80 backdrop-blur-sm px-4 py-2 flex items-center justify-between border-b border-border" style={{ top: `calc(var(--app-header-height, 0px) + ${actHeaderH}px)` }}>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {platoonGroup.platoonName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {platoonGroup.activities.length}
                  </span>
                </div>
                {platoonGroup.activities.map((activity) => (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    showPlatoon={false}
                    onClick={() => router.push(`/activities/${activity.id}`)}
                    onLongPress={canEdit ? (pos) => openContextMenu(activity, pos) : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {filtered.length > 0 && !activitiesByPlatoon && (
          <div>
            {filtered.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                showPlatoon={showPlatoon}
                onClick={() => router.push(`/activities/${activity.id}`)}
                onLongPress={canEdit ? (pos) => openContextMenu(activity, pos) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile FABs */}
      {canCreate && (
        <>
          <button
            type="button" onClick={() => setBulkOpen(true)}
            className="md:hidden fixed bottom-20 end-20 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg transition-transform active:scale-95"
            aria-label="ייבוא פעילויות"
          >
            <FileUp size={20} />
          </button>
          <button
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
