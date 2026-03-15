"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown } from "lucide-react";
import { useCycle } from "@/contexts/CycleContext";
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

interface ActivitiesResponse {
  role: string;
  canCreate: boolean;
  platoonIds: string[];
  platoons: { id: string; name: string }[];
  activities: ActivitySummary[];
}

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

export default function ActivitiesPage() {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<ActivitiesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const initialFilter = (searchParams.get("filter") as FilterPill | null) ?? "all";
  const [filter, setFilter] = useState<FilterPill>(
    (["all", "week", "gaps", "draft"] as FilterPill[]).includes(initialFilter)
      ? initialFilter
      : "all"
  );
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<"draft" | "active">("draft");
  const [notifying, setNotifying] = useState(false);

  function fetchActivities(cycleId: string) {
    setLoading(true);
    fetch(`/api/activities?cycleId=${cycleId}`)
      .then((r) => r.json())
      .then((d: ActivitiesResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!selectedCycleId) {
      setData(null);
      return;
    }
    fetchActivities(selectedCycleId);
  }, [selectedCycleId]);

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  }, []);

  const allActivities = data?.activities ?? [];

  const filtered = useMemo(() => {
    let list = [...allActivities];

    if (filter === "week") {
      list = list.filter((a) => {
        const d = a.date.split("T")[0];
        return d >= weekAgoStr && d <= todayStr;
      });
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

  const canCreate = data?.canCreate ?? false;
  const role = data?.role ?? "";
  const showPlatoon = role === "company_commander" || role === "admin";

  // Determine platoon options for create form
  const platoonOptions = useMemo(() => {
    return data?.platoons ?? [];
  }, [data?.platoons]);

  function handleCreateSuccess(activityId: string) {
    // We need to know the status of the created activity
    // Re-fetch to find out
    setCreateOpen(false);
    if (selectedCycleId) fetchActivities(selectedCycleId);
    // Check if status is active by looking at the refreshed list
    // For now, store the id and check after fetch
    setPendingActivityId(activityId);
  }

  async function handleNotify() {
    if (!pendingActivityId) return;
    setNotifying(true);
    try {
      await fetch(`/api/activities/${pendingActivityId}/notify`, { method: "POST" });
    } catch {
      // ignore
    } finally {
      setNotifying(false);
      setPendingActivityId(null);
    }
  }

  // Find if the pending activity is active (after data refresh)
  const pendingActivity = pendingActivityId
    ? allActivities.find((a) => a.id === pendingActivityId)
    : null;
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
          {/* Filter pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
            {FILTER_PILLS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Sort button */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              מיין
              <ChevronDown size={12} />
            </button>
            {sortOpen && (
              <div className="absolute end-0 top-full mt-1 z-30 min-w-[160px] rounded-lg border border-border bg-background shadow-md">
                {(Object.entries(SORT_LABELS) as [SortMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
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

          {/* Desktop create button */}
          {canCreate && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="hidden md:flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              <Plus size={15} />
              הוסף פעילות
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            טוען...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין פעילויות</p>
            {filter !== "all" && (
              <p className="text-sm text-muted-foreground">נסה לשנות את הסינון</p>
            )}
            {filter === "all" && canCreate && (
              <p className="text-sm text-muted-foreground">
                לחץ על + כדי ליצור פעילות חדשה
              </p>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
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
          type="button"
          onClick={() => setCreateOpen(true)}
          className="md:hidden fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          aria-label="הוסף פעילות"
        >
          <Plus size={24} />
        </button>
      )}

      {/* Create Activity Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>הוסף פעילות</DialogTitle>
          </DialogHeader>
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

      {/* Notify AlertDialog */}
      <AlertDialog
        open={showNotifyDialog}
        onOpenChange={(open) => { if (!open) setPendingActivityId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>הודע למ&quot;כים?</AlertDialogTitle>
            <AlertDialogDescription>
              האם לשלוח הודעה בדוא&quot;ל למפקדי הכיתות על הפעילות החדשה?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingActivityId(null)}>
              לא
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleNotify} disabled={notifying}>
              {notifying ? "שולח..." : "כן, שלח הודעה"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
