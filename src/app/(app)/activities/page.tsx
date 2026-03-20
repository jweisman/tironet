"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery, useStatus } from "@powersync/react";
import { ActivityCard, type ActivitySummary } from "@/components/activities/ActivityCard";
import { CreateActivityForm } from "@/components/activities/CreateActivityForm";
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterPill = "all" | "week" | "gaps" | "draft";
type SortMode = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const FILTER_LABELS: Record<FilterPill, string> = {
  all: "כולם",
  week: "השבוע",
  gaps: "עם פערים",
  draft: "טיוטה",
};
const FILTER_PILLS: FilterPill[] = ["all", "week", "gaps", "draft"];

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
  SELECT id, name FROM platoons WHERE company_id = ? ORDER BY sort_order ASC
`;

// ---------------------------------------------------------------------------
// Data mapping
// ---------------------------------------------------------------------------

interface RawActivity {
  id: string; name: string; date: string; status: string;
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
    status: raw.status as "draft" | "active",
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

  const syncStatus = useStatus();
  const role = selectedAssignment?.role ?? "";
  const canCreate = role !== "squad_commander" && !!role;

  // -------- PowerSync queries --------
  // Squad commanders see only their squad's counts; everyone else gets platoon-wide counts (squadId = '').
  const squadId = role === "squad_commander" ? (selectedAssignment?.unitId ?? "") : "";
  const queryParams = useMemo(() => [squadId, selectedCycleId ?? ""], [squadId, selectedCycleId]);
  const { data: rawActivities } = useQuery<RawActivity>(ACTIVITIES_QUERY, queryParams);

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
  const initialFilter = (searchParams.get("filter") as FilterPill | null) ?? "all";
  const [filter, setFilter] = useState<FilterPill>(
    (["all", "week", "gaps", "draft"] as FilterPill[]).includes(initialFilter) ? initialFilter : "all"
  );
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgoStr = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  }, []);

  const filtered = useMemo(() => {
    let list = [...allActivities];
    if (filter === "week") {
      list = list.filter((a) => { const d = a.date.split("T")[0]; return d >= weekAgoStr && d <= todayStr; });
    } else if (filter === "gaps") {
      list = list.filter((a) => a.isRequired && (a.missingCount > 0 || a.failedCount > 0));
    } else if (filter === "draft") {
      list = list.filter((a) => a.status === "draft");
    }
    list.sort((a, b) => {
      if (sortMode === "date-desc") return b.date.localeCompare(a.date);
      if (sortMode === "date-asc") return a.date.localeCompare(b.date);
      if (sortMode === "name-asc") return a.name.localeCompare(b.name, "he");
      if (sortMode === "name-desc") return b.name.localeCompare(a.name, "he");
      return 0;
    });
    return list;
  }, [allActivities, filter, sortMode, weekAgoStr, todayStr]);

  const showPlatoon = role === "company_commander";

  const platoonOptions = useMemo(() => {
    if (!selectedAssignment) return [];
    if (role === "platoon_commander") return [{ id: selectedAssignment.unitId, name: "המחלקה שלי" }];
    if (role === "company_commander") return companyPlatoons ?? [];
    return [];
  }, [selectedAssignment, role, companyPlatoons]);

  function handleCreateSuccess(activityId: string) {
    setCreateOpen(false);
    toast.success("הפעילות נוצרה בהצלחה");
    setPendingActivityId(activityId);
  }

  async function handleNotify() {
    if (!pendingActivityId) return;
    setNotifying(true);
    try { await fetch(`/api/activities/${pendingActivityId}/notify`, { method: "POST" }); }
    catch { /* ignore */ } finally { setNotifying(false); setPendingActivityId(null); }
  }

  const pendingActivity = pendingActivityId ? allActivities.find((a) => a.id === pendingActivityId) : null;
  const showNotifyDialog = !!pendingActivity && pendingActivity.status === "active";

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
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2">
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
            <button
              type="button" onClick={() => setCreateOpen(true)}
              className="hidden md:flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              <Plus size={15} /> הוסף פעילות
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="pb-32">
        {filtered.length === 0 && !syncStatus.hasSynced && filter === "all" && (
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
        {filtered.length === 0 && (syncStatus.hasSynced || filter !== "all") && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין פעילויות</p>
            {filter !== "all" && <p className="text-sm text-muted-foreground">נסה לשנות את הסינון</p>}
            {filter === "all" && canCreate && <p className="text-sm text-muted-foreground">לחץ על + כדי ליצור פעילות חדשה</p>}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="divide-y divide-border">
            {filtered.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                showPlatoon={showPlatoon}
                onClick={() => router.push(`/activities/${activity.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile FAB */}
      {canCreate && (
        <button
          type="button" onClick={() => setCreateOpen(true)}
          className="md:hidden fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          aria-label="הוסף פעילות"
        >
          <Plus size={24} />
        </button>
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

      <AlertDialog open={showNotifyDialog} onOpenChange={(open) => { if (!open) setPendingActivityId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>הודע למ&quot;כים?</AlertDialogTitle>
            <AlertDialogDescription>
              האם לשלוח הודעה בדוא&quot;ל למפקדי הכיתות על הפעילות החדשה?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingActivityId(null)}>לא</AlertDialogCancel>
            <AlertDialogAction onClick={handleNotify} disabled={notifying}>
              {notifying ? "שולח..." : "כן, שלח הודעה"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
