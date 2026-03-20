"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, AlertCircle, FileUp } from "lucide-react";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
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

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const SOLDIERS_QUERY = `
  SELECT
    s.id, s.given_name, s.family_name, s.rank, s.status, s.profile_image,
    s.squad_id,
    (
      SELECT COUNT(*)
      FROM activities a
      WHERE a.platoon_id = (SELECT platoon_id FROM squads WHERE id = s.squad_id)
        AND a.cycle_id = s.cycle_id
        AND a.is_required = 1
        AND a.status = 'active'
        AND (
          NOT EXISTS (
            SELECT 1 FROM activity_reports ar
            WHERE ar.activity_id = a.id AND ar.soldier_id = s.id
          )
          OR EXISTS (
            SELECT 1 FROM activity_reports ar
            WHERE ar.activity_id = a.id AND ar.soldier_id = s.id AND ar.result = 'failed'
          )
        )
    ) AS gap_count
  FROM soldiers s
  WHERE s.cycle_id = ?
  ORDER BY s.family_name ASC, s.given_name ASC
`;

const SQUADS_QUERY = `
  SELECT sq.id, sq.name, sq.platoon_id,
         p.name AS platoon_name
  FROM squads sq
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE c.cycle_id = ?
  ORDER BY p.sort_order ASC, sq.sort_order ASC
`;

interface RawSoldier {
  id: string;
  given_name: string;
  family_name: string;
  rank: string | null;
  status: string;
  profile_image: string | null;
  squad_id: string;
  gap_count: number;
}

interface RawSquad {
  id: string;
  name: string;
  platoon_id: string;
  platoon_name: string;
}

function mapSoldier(raw: RawSoldier): SoldierSummary {
  return {
    id: raw.id,
    givenName: raw.given_name,
    familyName: raw.family_name,
    rank: raw.rank ?? null,
    status: raw.status as SoldierStatus,
    profileImage: raw.profile_image ?? null,
    gapCount: Number(raw.gap_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SoldiersPage() {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const router = useRouter();
  const searchParams = useSearchParams();

  const role = selectedAssignment?.role ?? "";

  // -------- PowerSync queries --------
  const queryParams = useMemo(() => [selectedCycleId ?? ""], [selectedCycleId]);
  const { data: rawSoldiers } = useQuery<RawSoldier>(SOLDIERS_QUERY, queryParams);
  const { data: rawSquads } = useQuery<RawSquad>(SQUADS_QUERY, queryParams);

  const allSquads: SquadData[] = useMemo(() => {
    const squadMap = new Map<string, SquadData>();
    for (const sq of rawSquads ?? []) {
      squadMap.set(sq.id, {
        id: sq.id,
        name: sq.name,
        platoonId: sq.platoon_id,
        platoonName: sq.platoon_name,
        soldiers: [],
      });
    }
    for (const s of rawSoldiers ?? []) {
      const squad = squadMap.get(s.squad_id);
      if (squad) squad.soldiers.push(mapSoldier(s));
    }
    return Array.from(squadMap.values()).filter((sq) => sq.soldiers.length > 0);
  }, [rawSoldiers, rawSquads]);

  // -------- UI state --------
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showGapsOnly, setShowGapsOnly] = useState(
    searchParams.get("filter") === "gaps"
  );
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [lateJoinerInfo, setLateJoinerInfo] = useState<{
    count: number;
    soldierId: string;
  } | null>(null);
  const [markingNa, setMarkingNa] = useState(false);

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

  const squadsByPlatoon = useMemo(() => {
    if (role !== "company_commander") return null;
    const map = new Map<string, { platoonName: string; squads: SquadData[] }>();
    for (const squad of filteredSquads) {
      if (!map.has(squad.platoonId)) {
        map.set(squad.platoonId, { platoonName: squad.platoonName, squads: [] });
      }
      map.get(squad.platoonId)!.squads.push(squad);
    }
    return Array.from(map.values());
  }, [filteredSquads, role]);

  function handleImportSuccess(created: number, activeActivityCount: number) {
    setImportOpen(false);
    if (activeActivityCount > 0 && created > 0) {
      setLateJoinerInfo({ count: activeActivityCount, soldierId: "__bulk__" });
    }
  }

  function handleAddSuccess(activeActivityCount: number, soldierId: string) {
    setAddOpen(false);
    if (activeActivityCount > 0) {
      setLateJoinerInfo({ count: activeActivityCount, soldierId });
    }
  }

  async function handleMarkNa() {
    if (!lateJoinerInfo) return;
    setMarkingNa(true);
    try {
      if (lateJoinerInfo.soldierId !== "__bulk__") {
        await fetch(`/api/soldiers/${lateJoinerInfo.soldierId}/mark-na`, {
          method: "POST",
        });
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
            <span>פערים</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="pb-32">
        {totalSoldiers === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין חיילים</p>
            {(search || statusFilter !== "all" || showGapsOnly) && (
              <p className="text-sm text-muted-foreground">נסה לשנות את הסינון</p>
            )}
          </div>
        )}

        {role === "squad_commander" && (
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

        {role === "platoon_commander" && (
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

        {role === "company_commander" && squadsByPlatoon && (
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

      <AlertDialog
        open={!!lateJoinerInfo}
        onOpenChange={(open) => { if (!open) setLateJoinerInfo(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>פעילויות קיימות</AlertDialogTitle>
            <AlertDialogDescription>
              קיימות {lateJoinerInfo?.count} פעילויות פעילות לחייל. לסמן כ-לא רלוונטי?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLateJoinerInfo(null)}>לא</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkNa} disabled={markingNa}>
              {markingNa ? "מסמן..." : "כן, סמן כ-לא רלוונטי"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
