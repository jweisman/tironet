"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePowerSync } from "@powersync/react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BulkUpdateBar } from "./BulkUpdateBar";
import { BulkImportReportsDialog } from "./BulkImportReportsDialog";
import { ReportRow } from "./ReportRow";
import { ActivityTypeIcon } from "./ActivityTypeIcon";
import type { ActivityResult } from "@/types";
import type { ActiveScore } from "@/types/score-config";
import type { DisplayConfiguration } from "@/types/display-config";
import { getResultLabels, getNoteOptions } from "@/types/display-config";
import { formatGradeDisplay } from "@/lib/score-format";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { activityDetailTourSteps } from "@/lib/tour/steps";
import { useRef } from "react";

export type GradeKey = "grade1" | "grade2" | "grade3" | "grade4" | "grade5" | "grade6";
export const GRADE_KEYS: GradeKey[] = ["grade1", "grade2", "grade3", "grade4", "grade5", "grade6"];

export interface SoldierReport {
  id: string | null;
  result: ActivityResult | null;
  grade1: number | null;
  grade2: number | null;
  grade3: number | null;
  grade4: number | null;
  grade5: number | null;
  grade6: number | null;
  note: string | null;
}

export const EMPTY_REPORT: SoldierReport = {
  id: null, result: null,
  grade1: null, grade2: null, grade3: null,
  grade4: null, grade5: null, grade6: null,
  note: null,
};

interface SquadSoldier {
  id: string;
  givenName: string;
  familyName: string;
  rank: string | null;
  profileImage: string | null;
  status: string;
  idNumber: string | null;
  report: SoldierReport;
}

interface Squad {
  id: string;
  name: string;
  canEdit: boolean;
  soldiers: SquadSoldier[];
}

export interface ActivityDetailData {
  id: string;
  name: string;
  date: string;
  isRequired: boolean;
  activityType: { id: string; name: string; icon: string; activeScores: ActiveScore[]; displayConfiguration?: DisplayConfiguration | null };
  platoon: { id: string; name: string; companyName: string };
  role: string;
  canEditMetadata: boolean;
  canEditReports: boolean;
  squads: Squad[];
}

interface Props {
  initialData: ActivityDetailData;
  initialGapsOnly?: boolean;
}

interface ActivityType {
  id: string;
  name: string;
  icon: string;
}

function formatDate(isoString: string): string {
  const dateStr = isoString.split("T")[0];
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ActivityDetail({ initialData, initialGapsOnly = false }: Props) {
  const router = useRouter();
  const db = usePowerSync();
  const [data, setData] = useState<ActivityDetailData>(initialData);
  const [editingReports, setEditingReports] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showGapsOnly, setShowGapsOnly] = useState(initialGapsOnly);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importReportsOpen, setImportReportsOpen] = useState(false);

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "activity-detail", steps: activityDetailTourSteps });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  const activeScores = data.activityType.activeScores;
  const resultLabels = getResultLabels(data.activityType.displayConfiguration);
  const noteOptions = getNoteOptions(data.activityType.displayConfiguration);

  // Local reports state: Map<soldierId, SoldierReport>
  const [reports, setReports] = useState<Map<string, SoldierReport>>(() => {
    const map = new Map<string, SoldierReport>();
    for (const squad of initialData.squads) {
      for (const soldier of squad.soldiers) {
        map.set(soldier.id, { ...soldier.report });
      }
    }
    return map;
  });

  // Merge new soldiers from parent useQuery updates into local state.
  // The parent recalculates `initialData` as sync delivers soldiers
  // incrementally. We add new soldiers to `data` and `reports` without
  // touching existing entries — this avoids remounting the component
  // (which would discard in-progress edits from useState).
  useEffect(() => {
    // Merge into reports Map: add soldiers we haven't seen yet
    setReports((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const squad of initialData.squads) {
        for (const soldier of squad.soldiers) {
          if (!next.has(soldier.id)) {
            next.set(soldier.id, { ...soldier.report });
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });

    // Merge into data: add new soldiers to each squad, keep existing intact
    setData((prev) => {
      const prevSoldierIds = new Set<string>();
      for (const sq of prev.squads) {
        for (const s of sq.soldiers) prevSoldierIds.add(s.id);
      }

      let changed = false;
      const mergedSquads = prev.squads.map((prevSq) => {
        const incomingSq = initialData.squads.find((s) => s.id === prevSq.id);
        if (!incomingSq) return prevSq;
        const newSoldiers = incomingSq.soldiers.filter(
          (s) => !prevSoldierIds.has(s.id)
        );
        if (newSoldiers.length === 0) return prevSq;
        changed = true;
        return { ...prevSq, soldiers: [...prevSq.soldiers, ...newSoldiers] };
      });

      return changed ? { ...prev, squads: mergedSquads } : prev;
    });
  }, [initialData]);

  // Metadata edit state
  const [metaName, setMetaName] = useState(data.name);
  const [metaDate, setMetaDate] = useState(data.date.split("T")[0]);
  const [metaActivityTypeId, setMetaActivityTypeId] = useState(data.activityType.id);
  const [metaIsRequired, setMetaIsRequired] = useState(data.isRequired);
  const [metaSubmitting, setMetaSubmitting] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);

  // Debounce refs per soldier — clear all pending timeouts on unmount
  // to prevent stale callbacks firing against unmounted state.
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const refs = debounceRefs.current;
    return () => { refs.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (editingMetadata) {
      fetch("/api/activity-types")
        .then((r) => r.json())
        .then((d: ActivityType[]) => setActivityTypes(d))
        .catch(() => {});
    }
  }, [editingMetadata]);

  const saveReport = useCallback(
    async (soldierId: string, report: SoldierReport) => {
      setSaveError(null);

      try {
        if (report.id && report.result === null) {
          // Result cleared — delete the entire report row so the server
          // removes it too (issue #75). PowerSync queues a DELETE operation
          // that the connector uploads via DELETE /api/activity-reports/:id.
          await db.execute("DELETE FROM activity_reports WHERE id = ?", [report.id]);
          setReports((prev) => {
            const next = new Map(prev);
            next.set(soldierId, { ...EMPTY_REPORT });
            return next;
          });
        } else if (report.id) {
          await db.execute(
            "UPDATE activity_reports SET result = ?, grade1 = ?, grade2 = ?, grade3 = ?, grade4 = ?, grade5 = ?, grade6 = ?, note = ? WHERE id = ?",
            [report.result, report.grade1, report.grade2, report.grade3, report.grade4, report.grade5, report.grade6, report.note, report.id]
          );
        } else if (report.result !== null) {
          const newId = crypto.randomUUID();
          await db.execute(
            "INSERT INTO activity_reports (id, activity_id, soldier_id, result, grade1, grade2, grade3, grade4, grade5, grade6, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, data.id, soldierId, report.result, report.grade1, report.grade2, report.grade3, report.grade4, report.grade5, report.grade6, report.note]
          );
          setReports((prev) => {
            const next = new Map(prev);
            next.set(soldierId, { ...report, id: newId });
            return next;
          });
        }
      } catch {
        setSaveError("שגיאה בשמירת הדיווח");
      }
    },
    [data.id, db]
  );

  const handleReportChange = useCallback(
    (soldierId: string, field: "result" | GradeKey | "note", value: unknown) => {
      setReports((prev) => {
        const next = new Map(prev);
        const current = next.get(soldierId) ?? { ...EMPTY_REPORT };
        const updated = { ...current, [field]: value };
        next.set(soldierId, updated);

        if (field === "result") {
          saveReport(soldierId, updated);
        } else {
          const existing = debounceRefs.current.get(soldierId);
          if (existing) clearTimeout(existing);
          const timeout = setTimeout(() => {
            saveReport(soldierId, updated);
          }, 500);
          debounceRefs.current.set(soldierId, timeout);
        }

        return next;
      });
    },
    [saveReport]
  );

  async function handleBulkUpdate(result: ActivityResult) {
    setBulkLoading(true);
    setSaveError(null);

    const targets: Array<{ soldierId: string; report: SoldierReport }> = [];
    for (const squad of data.squads) {
      if (squad.canEdit) {
        for (const soldier of squad.soldiers) {
          const report = reports.get(soldier.id) ?? { ...EMPTY_REPORT };
          if (!report.result) {
            targets.push({ soldierId: soldier.id, report });
          }
        }
      }
    }

    if (targets.length === 0) {
      setBulkLoading(false);
      return;
    }

    try {
      const updates = new Map<string, SoldierReport>();

      // Batch all writes in a single transaction — one round-trip to the
      // SQLite worker instead of N sequential awaits.
      await db.writeTransaction(async (tx) => {
        for (const { soldierId, report } of targets) {
          if (report.id) {
            await tx.execute(
              "UPDATE activity_reports SET result = ? WHERE id = ?",
              [result, report.id]
            );
            updates.set(soldierId, { ...report, result });
          } else {
            const newId = crypto.randomUUID();
            await tx.execute(
              "INSERT INTO activity_reports (id, activity_id, soldier_id, result, grade1, grade2, grade3, grade4, grade5, grade6, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [newId, data.id, soldierId, result, report.grade1, report.grade2, report.grade3, report.grade4, report.grade5, report.grade6, report.note]
            );
            updates.set(soldierId, { ...report, result, id: newId });
          }
        }
      });

      setReports((prev) => {
        const next = new Map(prev);
        for (const [soldierId, updated] of updates) {
          next.set(soldierId, updated);
        }
        return next;
      });
      toast.success(hebrewCount(targets.length, "דיווח עודכן", "דיווחים עודכנו"));
    } catch {
      setSaveError("שגיאה בעדכון כללי");
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleImportReports(imported: Map<string, SoldierReport>) {
    setSaveError(null);
    const updates = new Map<string, SoldierReport>();

    await db.writeTransaction(async (tx) => {
      for (const [soldierId, report] of imported) {
        if (report.id) {
          await tx.execute(
            "UPDATE activity_reports SET result = ?, grade1 = ?, grade2 = ?, grade3 = ?, grade4 = ?, grade5 = ?, grade6 = ?, note = ? WHERE id = ?",
            [report.result, report.grade1, report.grade2, report.grade3, report.grade4, report.grade5, report.grade6, report.note, report.id]
          );
          updates.set(soldierId, report);
        } else if (report.result !== null) {
          const newId = crypto.randomUUID();
          await tx.execute(
            "INSERT INTO activity_reports (id, activity_id, soldier_id, result, grade1, grade2, grade3, grade4, grade5, grade6, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, data.id, soldierId, report.result, report.grade1, report.grade2, report.grade3, report.grade4, report.grade5, report.grade6, report.note]
          );
          updates.set(soldierId, { ...report, id: newId });
        }
      }
    });

    setReports((prev) => {
      const next = new Map(prev);
      for (const [soldierId, updated] of updates) {
        next.set(soldierId, updated);
      }
      return next;
    });

    setImportReportsOpen(false);
    toast.success(`${hebrewCount(updates.size, "דיווח יובא", "דיווחים יובאו")} בהצלחה`);
  }

  async function handleMetadataSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMetaSubmitting(true);
    setMetaError(null);

    try {
      const res = await fetch(`/api/activities/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: metaName,
          date: metaDate,
          activityTypeId: metaActivityTypeId,
          isRequired: metaIsRequired,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMetaError(err.error ?? "שגיאה בעדכון");
        return;
      }

      const resData = await res.json();
      const updated = resData.activity;
      setData((prev) => ({
        ...prev,
        name: updated.name,
        date: updated.date,
        status: updated.status,
        isRequired: updated.isRequired,
        activityType: {
          ...prev.activityType,
          ...updated.activityType,
        },
      }));
      setEditingMetadata(false);
      toast.success("הפעילות עודכנה בהצלחה");
    } catch {
      setMetaError("שגיאה בעדכון");
    } finally {
      setMetaSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/activities/${data.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.error ?? "שגיאה במחיקה");
        return;
      }
      toast.success("הפעילות נמחקה");
      router.push("/activities");
    } catch {
      setDeleteError("שגיאה במחיקה");
    } finally {
      setDeleting(false);
    }
  }

  const isGap = (soldierId: string) => {
    if (!data.isRequired) return false;
    const activityDate = data.date.split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    if (activityDate >= today) return false;
    const r = reports.get(soldierId);
    return !r || r.result === null || r.result === "failed";
  };

  const gapsCount = data.squads.reduce(
    (acc, squad) => acc + squad.soldiers.filter((s) => isGap(s.id)).length,
    0
  );

  const getResultIcon = (result: ActivityResult | null) => {
    if (result === "passed") return <span className="text-green-600">✓</span>;
    if (result === "failed") return <span className="text-red-600">✗</span>;
    if (result === "na") return <span className="text-muted-foreground">—</span>;
    return <span className="text-muted-foreground/30">·</span>;
  };

  return (
    <div className="-mx-4 -my-6">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-3">
        <div data-tour="activity-header" className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-bold text-muted-foreground">
            <ActivityTypeIcon
              icon={data.activityType.icon}
              name={data.activityType.name}
              size={22}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-tight">{data.name}</h1>
            <div className="text-sm text-muted-foreground mt-0.5">
              {data.activityType.name} · {formatDate(data.date)}
              {data.isRequired && <Badge variant="secondary" className="ms-2 text-[10px] px-1.5 py-0">חובה</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.platoon.companyName} / {data.platoon.name}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {gapsCount > 0 && (
            <button
              data-tour="activity-gaps-filter"
              type="button"
              onClick={() => setShowGapsOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                showGapsOnly
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-muted text-muted-foreground hover:bg-amber-100 hover:text-amber-800"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${showGapsOnly ? "bg-amber-500" : "bg-muted-foreground"}`} />
              פערים ({gapsCount})
            </button>
          )}
          <div className="flex-1" />
            {data.canEditMetadata && (
              <>
                <Button
                  data-tour="activity-edit-meta"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => {
                    setMetaName(data.name);
                    setMetaDate(data.date.split("T")[0]);
                    setMetaActivityTypeId(data.activityType.id);
                    setMetaIsRequired(data.isRequired);
                    setEditingMetadata(true);
                  }}
                  aria-label="ערוך פרטים"
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="מחק"
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}

            {data.canEditReports && (
              <>
                <Button
                  data-tour="activity-import-reports"
                  size="sm"
                  variant="outline"
                  onClick={() => setImportReportsOpen(true)}
                >
                  ייבוא דיווחים
                </Button>
                <Button
                  data-tour="activity-edit-reports"
                  size="sm"
                  variant={editingReports ? "default" : "outline"}
                  onClick={() => setEditingReports((v) => !v)}
                >
                  {editingReports ? "סיים עריכה" : "ערוך דיווח"}
                </Button>
              </>
            )}
        </div>

        {saveError && (
          <p className="text-xs text-destructive">{saveError}</p>
        )}
      </div>

      {/* Bulk update bar */}
      {editingReports && (
        <div className="sticky top-0 z-10">
          <BulkUpdateBar onBulkUpdate={handleBulkUpdate} loading={bulkLoading} resultLabels={resultLabels} />
        </div>
      )}

      {/* Squads & soldiers */}
      <div className="pb-24">
        {(() => { let firstSoldierTagged = false; return data.squads.map((squad) => {
          const visibleSoldiers = showGapsOnly
            ? squad.soldiers.filter((s) => isGap(s.id))
            : squad.soldiers;

          if (visibleSoldiers.length === 0) return null;

          return (
          <div key={squad.id}>
            {/* Squad header */}
            <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm px-4 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {squad.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {hebrewCount(visibleSoldiers.length, "חייל", "חיילים")}
              </span>
            </div>

            {editingReports && squad.canEdit ? (
              <div className="divide-y divide-border">
                {visibleSoldiers.map((soldier) => (
                  <ReportRow
                    key={soldier.id}
                    soldier={soldier}
                    report={reports.get(soldier.id) ?? EMPTY_REPORT}
                    activeScores={activeScores}
                    resultLabels={resultLabels}
                    noteOptions={noteOptions}
                    onChange={handleReportChange}
                  />
                ))}
              </div>
            ) : (
              <div>
                {/* Score column headers (only for multi-score activity types) */}
                {activeScores.length > 1 && (
                  <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border">
                    <div className="flex-1 min-w-0" />
                    <div className="hidden md:flex flex-1 min-w-0 text-[10px] text-muted-foreground">הערה</div>
                    <div className="flex shrink-0 mx-2">
                      {activeScores.map((score) => (
                        <span key={score.key} className="w-10 text-center text-[10px] text-muted-foreground truncate">
                          {score.label}
                        </span>
                      ))}
                    </div>
                    <div className="shrink-0 w-6" />
                  </div>
                )}
                <div className="divide-y divide-border">
                {visibleSoldiers.map((soldier) => {
                  const report = reports.get(soldier.id) ?? { ...EMPTY_REPORT };
                  const hasGrades = activeScores.some((s) => report[s.gradeKey] != null);
                  const tagRow = !firstSoldierTagged;
                  if (tagRow) firstSoldierTagged = true;
                  return (
                    <div key={soldier.id} data-tour={tagRow ? "activity-soldier-row" : undefined} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">
                            {soldier.familyName} {soldier.givenName}
                          </span>
                          {soldier.rank && (
                            <span className="ms-2 text-xs text-muted-foreground">
                              {soldier.rank}
                            </span>
                          )}
                        </div>
                        {report.note ? (
                          <p className="hidden md:block flex-1 min-w-0 text-xs text-muted-foreground truncate" title={report.note}>
                            {report.note}
                          </p>
                        ) : activeScores.length > 1 ? (
                          <div className="hidden md:block flex-1 min-w-0" />
                        ) : null}
                        {hasGrades && (
                          <div className="flex shrink-0 mx-2">
                            {activeScores.length === 1 && report[activeScores[0].gradeKey] != null && (
                              <span className="text-xs font-medium">
                                {formatGradeDisplay(report[activeScores[0].gradeKey], activeScores[0].format)}
                              </span>
                            )}
                            {activeScores.length > 1 && activeScores.map((score) => {
                              const val = report[score.gradeKey];
                              return (
                                <span key={score.key} className="w-10 text-center text-xs font-medium">
                                  {val != null ? formatGradeDisplay(val, score.format) : "—"}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {!hasGrades && activeScores.length > 1 && (
                          <div className="shrink-0 mx-2" style={{ width: activeScores.length * 40 }} />
                        )}
                        <div className="shrink-0 text-base w-6 text-center">
                          {getResultIcon(report.result)}
                        </div>
                      </div>
                      {report.note && (
                        <p className="md:hidden text-xs text-muted-foreground mt-1 truncate">
                          {report.note}
                        </p>
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            )}
          </div>
          );
        }); })()}
      </div>

      {/* Import reports dialog */}
      {data.canEditReports && (
        <BulkImportReportsDialog
          open={importReportsOpen}
          onOpenChange={setImportReportsOpen}
          activityId={data.id}
          activityTypeId={data.activityType.id}
          activeScores={activeScores}
          soldiers={data.squads
            .filter((sq) => sq.canEdit)
            .flatMap((sq) =>
              sq.soldiers.map((s) => ({
                id: s.id,
                idNumber: s.idNumber,
                givenName: s.givenName,
                familyName: s.familyName,
              }))
            )}
          existingReports={reports}
          resultLabels={resultLabels}
          noteOptions={noteOptions}
          onImport={handleImportReports}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת פעילות</DialogTitle>
            <DialogDescription>
              האם למחוק את הפעילות &quot;{data.name}&quot;? פעולה זו תמחק גם את כל הדיווחים הקשורים אליה ולא ניתן לבטלה.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "מוחק..." : "מחק"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Metadata edit dialog */}
      <Dialog open={editingMetadata} onOpenChange={setEditingMetadata}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ערוך פרטי פעילות</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleMetadataSubmit} className="space-y-4">
            {/* Activity type */}
            <div className="space-y-1.5">
              <Label>סוג פעילות</Label>
              <Select value={metaActivityTypeId} onValueChange={(v) => { if (v !== null) setMetaActivityTypeId(v); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="בחר סוג">
                  {(activityTypes.find((t) => t.id === metaActivityTypeId) ?? data.activityType).name}
                </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activityTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                  {activityTypes.length === 0 && (
                    <SelectItem value={data.activityType.id}>
                      {data.activityType.name}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="meta-name">שם הפעילות</Label>
              <Input
                id="meta-name"
                value={metaName}
                onChange={(e) => setMetaName(e.target.value)}
              />
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="meta-date">תאריך</Label>
              <Input
                id="meta-date"
                type="date"
                value={metaDate}
                onChange={(e) => setMetaDate(e.target.value)}
                dir="ltr"
              />
            </div>

            {/* Required */}
            <div className="flex items-center justify-between">
              <Label htmlFor="meta-required">פעילות חובה</Label>
              <Switch
                id="meta-required"
                checked={metaIsRequired}
                onCheckedChange={setMetaIsRequired}
              />
            </div>

            {metaError && (
              <p className="text-sm text-destructive">{metaError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingMetadata(false)}
                disabled={metaSubmitting}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={metaSubmitting}>
                {metaSubmitting ? "שומר..." : "שמור"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
