"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, AlertCircle, FileUp, FileText, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
import { useSyncReady } from "@/hooks/useSyncReady";
import { effectiveRole } from "@/lib/auth/permissions";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { soldiersTourSteps } from "@/lib/tour/steps";
import type { Role, RequestType } from "@/types";
import { SoldierCard, type SoldierSummary } from "@/components/soldiers/SoldierCard";
import { AddSoldierForm } from "@/components/soldiers/AddSoldierForm";
import dynamic from "next/dynamic";

const BulkImportDialog = dynamic(() => import("@/components/soldiers/BulkImportDialog").then(m => m.BulkImportDialog));
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
import { Skeleton } from "@/components/ui/skeleton";
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
  "active",
  "all",
];

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const SOLDIERS_QUERY = `
  SELECT
    s.id, s.given_name, s.family_name, s.id_number, s.rank, s.status, s.profile_image, s.phone,
    s.squad_id,
    (
      SELECT COUNT(*)
      FROM activities a
      WHERE a.platoon_id = (SELECT platoon_id FROM squads WHERE id = s.squad_id)
        AND a.cycle_id = s.cycle_id
        AND a.is_required = 1
        AND a.status = 'active'
        AND a.date < DATE('now')
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
    ) AS gap_count,
    (
      SELECT COUNT(*)
      FROM requests r
      WHERE r.soldier_id = s.id
        AND r.cycle_id = s.cycle_id
        AND r.assigned_role IS NOT NULL
        AND r.status != 'approved'
    ) AS open_request_count
  FROM soldiers s
  WHERE s.cycle_id = ?
  ORDER BY s.family_name ASC, s.given_name ASC
`;

const APPROVED_REQUESTS_QUERY = `
  SELECT r.soldier_id, r.type
  FROM requests r
  WHERE r.cycle_id = ?
    AND r.status = 'approved'
    AND (
      (r.type = 'leave' AND (r.departure_at >= DATE('now') OR r.return_at >= DATE('now')))
      OR (r.type = 'medical' AND r.medical_appointments IS NOT NULL AND EXISTS (
        SELECT 1 FROM json_each(r.medical_appointments) AS a
        WHERE json_extract(a.value, '$.date') >= DATE('now')
      ))
      OR r.type = 'hardship'
    )
`;

interface RawApprovedRequest {
  soldier_id: string;
  type: string;
}

const SQUADS_QUERY = `
  SELECT sq.id, sq.name, sq.platoon_id,
         p.name AS platoon_name
  FROM squads sq
  JOIN platoons p ON p.id = sq.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE c.cycle_id = ?
  ORDER BY p.sort_order ASC, p.name ASC, sq.sort_order ASC, sq.name ASC
`;

interface RawSoldier {
  id: string;
  given_name: string;
  family_name: string;
  id_number: string | null;
  rank: string | null;
  status: string;
  profile_image: string | null;
  phone: string | null;
  squad_id: string;
  gap_count: number;
  open_request_count: number;
}

interface RawSquad {
  id: string;
  name: string;
  platoon_id: string;
  platoon_name: string;
}

function mapSoldier(raw: RawSoldier, approvedTypes: RequestType[]): SoldierSummary {
  return {
    id: raw.id,
    givenName: raw.given_name,
    familyName: raw.family_name,
    idNumber: raw.id_number ?? null,
    rank: raw.rank ?? null,
    status: raw.status as SoldierStatus,
    profileImage: raw.profile_image ?? null,
    phone: raw.phone ?? null,
    gapCount: Number(raw.gap_count ?? 0),
    openRequestCount: Number(raw.open_request_count ?? 0),
    approvedRequestTypes: approvedTypes,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SoldiersPage() {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawRole = (selectedAssignment?.role ?? "") as Role | "";
  const role = rawRole ? effectiveRole(rawRole as Role) : "";
  const noAccess = rawRole === "instructor" || rawRole === "company_medic";

  // -------- PowerSync queries --------
  const queryParams = useMemo(() => [selectedCycleId ?? ""], [selectedCycleId]);
  const { data: rawSoldiers, isLoading: soldiersLoading } = useQuery<RawSoldier>(SOLDIERS_QUERY, queryParams);
  const { data: rawSquads } = useQuery<RawSquad>(SQUADS_QUERY, queryParams);
  const { data: rawApprovedRequests } = useQuery<RawApprovedRequest>(APPROVED_REQUESTS_QUERY, queryParams);
  const { showLoading, showEmpty, showConnectionError } = useSyncReady(
    (rawSoldiers ?? []).length > 0,
    soldiersLoading
  );

  const allSquads: SquadData[] = useMemo(() => {
    // Build soldier → approved request types map
    const approvedMap = new Map<string, RequestType[]>();
    for (const ar of rawApprovedRequests ?? []) {
      const types = approvedMap.get(ar.soldier_id);
      if (types) types.push(ar.type as RequestType);
      else approvedMap.set(ar.soldier_id, [ar.type as RequestType]);
    }

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
      if (squad) squad.soldiers.push(mapSoldier(s, approvedMap.get(s.id) ?? []));
    }
    let squads = Array.from(squadMap.values()).filter((sq) => sq.soldiers.length > 0);
    // Squad commanders see only their own squad
    if (role === "squad_commander" && selectedAssignment?.unitId) {
      squads = squads.filter((sq) => sq.id === selectedAssignment.unitId);
    }
    return squads;
  }, [rawSoldiers, rawSquads, rawApprovedRequests, role, selectedAssignment?.unitId]);

  const existingIdNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const s of rawSoldiers ?? []) {
      if (s.id_number) set.add(s.id_number);
    }
    return set;
  }, [rawSoldiers]);

  // -------- Sticky header offset --------
  // AppShell publishes --app-header-height as a CSS variable.
  // We measure our own sticky bar + platoon header heights with ResizeObserver,
  // then combine with the CSS variable via calc() to avoid timing issues.
  const stickyBarRef = useRef<HTMLDivElement>(null);
  const platoonHeaderRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  const [platoonH, setPlatoonH] = useState(36);
  useEffect(() => {
    const el = stickyBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = platoonHeaderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPlatoonH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -------- UI state --------
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [showGapsOnly, setShowGapsOnly] = useState(
    searchParams.get("filter") === "gaps"
  );
  const [showRequestsOnly, setShowRequestsOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [lateJoinerInfo, setLateJoinerInfo] = useState<{
    count: number;
    soldierId: string;
    soldierIds?: string[];
  } | null>(null);
  const [markingNa, setMarkingNa] = useState(false);

  const filteredSquads = useMemo(() => {
    return allSquads
      .map((squad) => ({
        ...squad,
        soldiers: squad.soldiers.filter((s) => {
          if (statusFilter !== "all" && s.status !== statusFilter) return false;
          if (showGapsOnly && s.gapCount === 0) return false;
          if (showRequestsOnly && s.openRequestCount === 0 && s.approvedRequestTypes.length === 0) return false;
          if (search.trim()) {
            const q = search.trim().toLowerCase();
            const fullName = `${s.familyName} ${s.givenName}`.toLowerCase();
            const matchesName = fullName.includes(q);
            const matchesId = s.idNumber?.includes(q) ?? false;
            const matchesPhone = s.phone?.includes(q) ?? false;
            if (!matchesName && !matchesId && !matchesPhone) return false;
          }
          return true;
        }),
      }))
      .filter((sq) => sq.soldiers.length > 0);
  }, [allSquads, statusFilter, showGapsOnly, showRequestsOnly, search]);

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

  function handleImportSuccess(created: number, updated: number, activeActivityCount: number, soldierIds?: string[]) {
    setImportOpen(false);
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} חיילים נוספו`);
    if (updated > 0) parts.push(`${updated} חיילים עודכנו`);
    toast.success(parts.join(", ") || "הייבוא הושלם");
    if (activeActivityCount > 0 && created > 0 && soldierIds?.length) {
      setLateJoinerInfo({ count: activeActivityCount, soldierId: "__bulk__", soldierIds });
    }
  }

  function handleAddSuccess(activeActivityCount: number, soldierId: string) {
    setAddOpen(false);
    toast.success("החייל נוסף בהצלחה");
    if (activeActivityCount > 0) {
      setLateJoinerInfo({ count: activeActivityCount, soldierId });
    }
  }

  async function handleMarkNa() {
    if (!lateJoinerInfo) return;
    setMarkingNa(true);
    try {
      const ids = lateJoinerInfo.soldierIds ?? [lateJoinerInfo.soldierId];
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/soldiers/${id}/mark-na`, { method: "POST" })
        )
      );
    } catch {
      // ignore
    } finally {
      setMarkingNa(false);
      setLateJoinerInfo(null);
    }
  }

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "soldiers", steps: soldiersTourSteps });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  if (noAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין גישה לעמוד זה</p>
        <p className="text-muted-foreground text-sm">עמוד החיילים אינו זמין עבור תפקיד זה.</p>
      </div>
    );
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

  const squadsForForm = (rawSquads ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    platoonId: s.platoon_id,
    platoonName: s.platoon_name,
  }));
  const defaultSquadId =
    role === "squad_commander" && squadsForForm.length === 1
      ? squadsForForm[0].id
      : undefined;

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky top search + gaps filter */}
      <div ref={stickyBarRef} className="sticky z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2" style={{ top: "var(--app-header-height, 0px)" }}>
        <div className="flex items-center gap-2">
          <div data-tour="soldiers-search" className="relative flex-1">
            <Search
              size={16}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              placeholder="חיפוש לפי שם, מ״א או טלפון..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pe-8"
            />
          </div>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              data-tour="soldiers-import-btn"
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <FileUp size={15} />
              ייבוא
            </button>
            <button
              data-tour="soldiers-add-btn"
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
          <div data-tour="soldiers-status-filters" className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
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
            data-tour="soldiers-requests-filter"
            type="button"
            onClick={() => setShowRequestsOnly((v) => !v)}
            className={cn(
              "shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              showRequestsOnly
                ? "bg-amber-100 text-amber-800"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <FileText size={12} />
            <span>בקשות פעילות</span>
          </button>
          <button
            data-tour="soldiers-gaps-filter"
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
        {totalSoldiers === 0 && showLoading && !search && (statusFilter === "all" || statusFilter === "active") && !showGapsOnly && !showRequestsOnly && (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        )}
        {totalSoldiers === 0 && showConnectionError && !search && (statusFilter === "all" || statusFilter === "active") && !showGapsOnly && !showRequestsOnly && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
            <p className="font-medium">לא ניתן לטעון נתונים</p>
            <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
          </div>
        )}
        {totalSoldiers === 0 && (showEmpty || search || (statusFilter !== "all" && statusFilter !== "active") || showGapsOnly || showRequestsOnly) && !showLoading && !showConnectionError && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין חיילים</p>
            {(search || (statusFilter !== "all" && statusFilter !== "active") || showGapsOnly || showRequestsOnly) && (
              <p className="text-sm text-muted-foreground">נסה לשנות את הסינון</p>
            )}
          </div>
        )}

        {role === "squad_commander" && (
          <div className="divide-y divide-border">
            {filteredSquads.flatMap((sq, sqi) =>
              sq.soldiers.map((s, si) => (
                <SoldierCard
                  key={s.id}
                  soldier={s}
                  onClick={() => router.push(`/soldiers/${s.id}`)}
                  dataTour={sqi === 0 && si === 0 ? "soldiers-card" : undefined}
                />
              ))
            )}
          </div>
        )}

        {role === "platoon_commander" && (
          <div>
            {filteredSquads.map((squad, sqi) => (
              <div key={squad.id}>
                <div className="sticky z-10 bg-muted px-4 py-2 flex items-center justify-between border-b border-border" style={{ top: `calc(var(--app-header-height, 0px) + ${barH}px)` }}>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {squad.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {squad.soldiers.length}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {squad.soldiers.map((s, si) => (
                    <SoldierCard
                      key={s.id}
                      soldier={s}
                      onClick={() => router.push(`/soldiers/${s.id}`)}
                      dataTour={sqi === 0 && si === 0 ? "soldiers-card" : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {role === "company_commander" && squadsByPlatoon && (
          <div>
            {squadsByPlatoon.map((platoonGroup, pi) => (
              <div key={platoonGroup.platoonName}>
                <div ref={platoonHeaderRef} className="sticky z-[11] bg-background border-b border-border px-4 py-2 flex items-center justify-between" style={{ top: `calc(var(--app-header-height, 0px) + ${barH}px)` }}>
                  <span className="text-sm font-semibold">
                    {platoonGroup.platoonName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {platoonGroup.squads.reduce((sum, sq) => sum + sq.soldiers.length, 0)}
                  </span>
                </div>
                {platoonGroup.squads.map((squad, sqi) => (
                  <div key={squad.id}>
                    <div className="sticky z-10 bg-muted px-4 py-1.5 flex items-center justify-between border-b border-border" style={{ top: `calc(var(--app-header-height, 0px) + ${barH + platoonH}px)` }}>
                      <span className="text-xs font-medium text-muted-foreground">
                        {squad.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {squad.soldiers.length}
                      </span>
                    </div>
                    <div className="divide-y divide-border">
                      {squad.soldiers.map((s, si) => (
                        <SoldierCard
                          key={s.id}
                          soldier={s}
                          onClick={() => router.push(`/soldiers/${s.id}`)}
                          dataTour={pi === 0 && sqi === 0 && si === 0 ? "soldiers-card" : undefined}
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
          existingIdNumbers={existingIdNumbers}
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
