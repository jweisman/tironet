"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, AlertCircle, FileUp } from "lucide-react";
import { useCycle } from "@/contexts/CycleContext";
import { SoldierCard, type SoldierSummary } from "@/components/soldiers/SoldierCard";
import { AddSoldierForm } from "@/components/soldiers/AddSoldierForm";
import { BulkImportDialog } from "@/components/soldiers/BulkImportDialog";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SoldierStatus } from "@/types";

interface SquadData {
  id: string;
  name: string;
  platoonId: string;
  platoonName: string;
  soldiers: SoldierSummary[];
}

interface SoldiersResponse {
  role: string;
  squads: SquadData[];
}

type StatusFilter = "all" | SoldierStatus;

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "כולם",
  active: "פעיל",
  transferred: "הועבר",
  dropped: "נשר",
  injured: "פצוע",
};

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "active",
  "transferred",
  "dropped",
  "injured",
];

export default function SoldiersPage() {
  const { selectedCycleId } = useCycle();
  const router = useRouter();

  const [data, setData] = useState<SoldiersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showGapsOnly, setShowGapsOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Late-joiner dialog state
  const [lateJoinerInfo, setLateJoinerInfo] = useState<{
    count: number;
    soldierId: string;
  } | null>(null);
  const [markingNa, setMarkingNa] = useState(false);

  useEffect(() => {
    if (!selectedCycleId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/soldiers?cycleId=${selectedCycleId}`)
      .then((r) => r.json())
      .then((d: SoldiersResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  const allSquads: SquadData[] = data?.squads ?? [];
  const role = data?.role ?? "";

  const filteredSquads = useMemo(() => {
    return allSquads
      .map((squad) => ({
        ...squad,
        soldiers: squad.soldiers.filter((s) => {
          if (statusFilter !== "all" && s.status !== statusFilter) return false;
          if (showGapsOnly && s.gapCount === 0) return false;
          if (search.trim()) {
            const q = search.trim().toLowerCase();
            const fullName = `${s.familyName} ${s.givenName}`.toLowerCase();
            if (!fullName.includes(q)) return false;
          }
          return true;
        }),
      }))
      .filter((sq) => sq.soldiers.length > 0);
  }, [allSquads, statusFilter, showGapsOnly, search]);

  const totalSoldiers = filteredSquads.reduce(
    (sum, sq) => sum + sq.soldiers.length,
    0
  );

  // Group by platoon for company_commander
  const squadsByPlatoon = useMemo(() => {
    if (role !== "company_commander") return null;
    const map = new Map<
      string,
      { platoonName: string; squads: SquadData[] }
    >();
    for (const squad of filteredSquads) {
      if (!map.has(squad.platoonId)) {
        map.set(squad.platoonId, {
          platoonName: squad.platoonName,
          squads: [],
        });
      }
      map.get(squad.platoonId)!.squads.push(squad);
    }
    return Array.from(map.values());
  }, [filteredSquads, role]);

  function handleImportSuccess(created: number, activeActivityCount: number) {
    setImportOpen(false);
    if (selectedCycleId) {
      fetch(`/api/soldiers?cycleId=${selectedCycleId}`)
        .then((r) => r.json())
        .then((d: SoldiersResponse) => setData(d))
        .catch(() => {});
    }
    // If there are active activities, show late-joiner prompt (use a synthetic id)
    if (activeActivityCount > 0 && created > 0) {
      setLateJoinerInfo({ count: activeActivityCount, soldierId: "__bulk__" });
    }
  }

  function handleAddSuccess(activeActivityCount: number, soldierId: string) {
    setAddOpen(false);
    // Refresh data
    if (selectedCycleId) {
      fetch(`/api/soldiers?cycleId=${selectedCycleId}`)
        .then((r) => r.json())
        .then((d: SoldiersResponse) => setData(d))
        .catch(() => {});
    }
    if (activeActivityCount > 0) {
      setLateJoinerInfo({ count: activeActivityCount, soldierId });
    }
  }

  async function handleMarkNa() {
    if (!lateJoinerInfo) return;
    setMarkingNa(true);
    try {
      // bulk import: no single soldier to mark — just dismiss
      if (lateJoinerInfo.soldierId !== "__bulk__") {
        await fetch(`/api/soldiers/${lateJoinerInfo.soldierId}/mark-na`, {
          method: "POST",
        });
      }
      // Refresh
      if (selectedCycleId) {
        fetch(`/api/soldiers?cycleId=${selectedCycleId}`)
          .then((r) => r.json())
          .then((d: SoldiersResponse) => setData(d))
          .catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      setMarkingNa(false);
      setLateJoinerInfo(null);
    }
  }

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
        <p className="text-muted-foreground text-sm">
          בחר מחזור פעיל כדי לצפות בחיילים.
        </p>
      </div>
    );
  }

  const squadsForForm = allSquads.map((s) => ({ id: s.id, name: s.name }));
  const defaultSquadId =
    role === "squad_commander" && allSquads.length === 1
      ? allSquads[0].id
      : undefined;

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky top search + gaps filter */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              placeholder="חיפוש חייל..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pe-8"
            />
          </div>
          {/* Desktop action buttons */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <FileUp size={15} />
              ייבוא
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={15} />
              הוסף חייל
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  statusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {STATUS_LABELS[f]}
              </button>
            ))}
          </div>
          {/* Gaps only toggle */}
          <button
            type="button"
            onClick={() => setShowGapsOnly((v) => !v)}
            className={cn(
              "shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              showGapsOnly
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <AlertCircle size={12} />
            <span>חסרים</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            טוען...
          </div>
        )}

        {!loading && totalSoldiers === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין חיילים</p>
            {(search || statusFilter !== "all" || showGapsOnly) && (
              <p className="text-sm text-muted-foreground">
                נסה לשנות את הסינון
              </p>
            )}
          </div>
        )}

        {/* squad_commander: flat list */}
        {!loading && role === "squad_commander" && (
          <div className="divide-y divide-border">
            {filteredSquads.flatMap((sq) =>
              sq.soldiers.map((s) => (
                <SoldierCard
                  key={s.id}
                  soldier={s}
                  onClick={() => router.push(`/soldiers/${s.id}`)}
                />
              ))
            )}
          </div>
        )}

        {/* platoon_commander: section header per squad */}
        {!loading && role === "platoon_commander" && (
          <div>
            {filteredSquads.map((squad) => (
              <div key={squad.id}>
                <div className="sticky top-[104px] z-10 bg-muted/80 backdrop-blur-sm px-4 py-2 flex items-center justify-between border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {squad.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {squad.soldiers.length}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {squad.soldiers.map((s) => (
                    <SoldierCard
                      key={s.id}
                      soldier={s}
                      onClick={() => router.push(`/soldiers/${s.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* company_commander: platoon header + squad sub-header */}
        {!loading && role === "company_commander" && squadsByPlatoon && (
          <div>
            {squadsByPlatoon.map((platoonGroup) => (
              <div key={platoonGroup.platoonName}>
                <div className="sticky top-[104px] z-10 bg-background border-b border-border px-4 py-2">
                  <span className="text-sm font-semibold">
                    {platoonGroup.platoonName}
                  </span>
                </div>
                {platoonGroup.squads.map((squad) => (
                  <div key={squad.id}>
                    <div className="bg-muted/50 px-4 py-1.5 flex items-center justify-between border-b border-border">
                      <span className="text-xs font-medium text-muted-foreground">
                        {squad.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {squad.soldiers.length}
                      </span>
                    </div>
                    <div className="divide-y divide-border">
                      {squad.soldiers.map((s) => (
                        <SoldierCard
                          key={s.id}
                          soldier={s}
                          onClick={() => router.push(`/soldiers/${s.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* admin: flat by squad with platoon/squad label */}
        {!loading && role === "admin" && (
          <div>
            {filteredSquads.map((squad) => (
              <div key={squad.id}>
                <div className="sticky top-[104px] z-10 bg-muted/80 backdrop-blur-sm px-4 py-2 flex items-center justify-between border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {squad.platoonName} / {squad.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {squad.soldiers.length}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {squad.soldiers.map((s) => (
                    <SoldierCard
                      key={s.id}
                      soldier={s}
                      onClick={() => router.push(`/soldiers/${s.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FABs — mobile only */}
      <button
        type="button"
        onClick={() => setImportOpen(true)}
        className="md:hidden fixed bottom-20 end-20 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg transition-transform active:scale-95"
        aria-label="ייבוא חיילים"
      >
        <FileUp size={20} />
      </button>
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="md:hidden fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
        aria-label="הוסף חייל"
      >
        <Plus size={24} />
      </button>

      {/* Add Soldier Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>הוסף חייל</DialogTitle>
          </DialogHeader>
          {selectedCycleId && (
            <AddSoldierForm
              cycleId={selectedCycleId}
              squads={squadsForForm}
              defaultSquadId={defaultSquadId}
              onSuccess={handleAddSuccess}
              onCancel={() => setAddOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      {selectedCycleId && (
        <BulkImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          cycleId={selectedCycleId}
          squads={squadsForForm}
          defaultSquadId={defaultSquadId}
          onSuccess={handleImportSuccess}
        />
      )}

      {/* Late-joiner AlertDialog */}
      <AlertDialog
        open={!!lateJoinerInfo}
        onOpenChange={(open) => {
          if (!open) setLateJoinerInfo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>פעילויות קיימות</AlertDialogTitle>
            <AlertDialogDescription>
              קיימות {lateJoinerInfo?.count} פעילויות פעילות לחייל. לסמן
              כ-לא רלוונטי?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLateJoinerInfo(null)}>
              לא
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkNa} disabled={markingNa}>
              {markingNa ? "מסמן..." : "כן, סמן כ-לא רלוונטי"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
