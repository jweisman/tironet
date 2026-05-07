"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, AlertCircle, FileUp, FileText, WifiOff, HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import { useCycle } from "@/contexts/CycleContext";
import { useTrackedQuery } from "@/hooks/useTrackedQuery";
import { useSyncReady } from "@/hooks/useSyncReady";
import { effectiveRole } from "@/lib/auth/permissions";
import { isRequestOpen } from "@/lib/requests/active";
import { usePagePerf } from "@/hooks/usePagePerf";
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
import { SearchInput } from "@/components/ui/SearchInput";
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
    s.id, s.given_name, s.family_name, s.id_number, s.civilian_id, s.rank, s.status, s.profile_image, s.phone,
    s.squad_id
  FROM soldiers s
  WHERE s.cycle_id = ?
  ORDER BY s.family_name ASC, s.given_name ASC
`;

// Gap count as a single aggregation query instead of a correlated subquery per soldier.
// Counts activities where the soldier has no report, a skipped report, or a failed report.
// COUNT(*) (not COUNT(DISTINCT a.id)): the join produces at most one row per (soldier, activity)
// because the (activity_id, soldier_id) pair is unique in activity_reports. wa-sqlite's
// COUNT(DISTINCT) was timing out at 5s+ on iOS Safari with 5k+ activity_reports.
const GAP_COUNT_QUERY = `
  SELECT s.id AS soldier_id, COUNT(*) AS gap_count
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN activities a ON a.platoon_id = sq.platoon_id
    AND a.cycle_id = s.cycle_id
    AND a.is_required = 1
    AND a.status = 'active'
    AND a.date < DATE('now')
  LEFT JOIN activity_reports ar ON ar.activity_id = a.id AND ar.soldier_id = s.id
  WHERE s.cycle_id = ?
    AND (ar.id IS NULL OR ar.result = 'skipped' OR ar.failed = 1)
  GROUP BY s.id
`;

// Open request count as a single aggregation query instead of a correlated subquery per soldier.
const OPEN_REQUEST_COUNT_QUERY = `
  SELECT r.soldier_id, COUNT(*) AS open_request_count
  FROM requests r
  WHERE r.cycle_id = ?
    AND r.status = 'open'
  GROUP BY r.soldier_id
`;

// Open requests = active (approved + date criteria) OR in-progress (status open).
// Used for the active request icons on soldier cards and the "open requests" filter.
//
// Previous version inlined the date logic with json_each() over medical_appointments and
// sick_days. wa-sqlite's json_each was so slow that even EXPLAIN QUERY PLAN timed out
// (>5s) on iOS Safari. Now we fetch the candidate set (open + approved leave/medical)
// and filter in JS using the shared isRequestOpen() helper.
const OPEN_REQUESTS_QUERY = `
  SELECT r.soldier_id, r.type, r.status, r.urgent, r.special_conditions,
         r.departure_at, r.return_at, r.medical_appointments, r.sick_days
  FROM requests r
  WHERE r.cycle_id = ?
    AND (r.status = 'open' OR (r.status = 'approved' AND r.type IN ('leave', 'medical')))
`;

// Approved hardship requests — separate from "active" since they have no date criteria.
// Used for the hardship filter pill and hardship icons on soldier cards.
const HARDSHIP_REQUESTS_QUERY = `
  SELECT r.soldier_id, r.urgent, r.special_conditions
  FROM requests r
  WHERE r.cycle_id = ?
    AND r.status = 'approved'
    AND r.type = 'hardship'
`;

interface RawOpenRequest {
  soldier_id: string;
  type: string;
  status: string;
  urgent: number | null;
  special_conditions: number | null;
  departure_at: string | null;
  return_at: string | null;
  medical_appointments: string | null;
  sick_days: string | null;
}

interface RawHardshipRequest {
  soldier_id: string;
  urgent: number | null;
  special_conditions: number | null;
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
  civilian_id: string | null;
  rank: string | null;
  status: string;
  profile_image: string | null;
  phone: string | null;
  squad_id: string;
}

interface RawGapCount {
  soldier_id: string;
  gap_count: number;
}

interface RawOpenRequestCount {
  soldier_id: string;
  open_request_count: number;
}

interface RawSquad {
  id: string;
  name: string;
  platoon_id: string;
  platoon_name: string;
}

function mapSoldier(raw: RawSoldier, approvedRequests: { type: RequestType; urgent: boolean }[], gapCount: number, openRequestCount: number): SoldierSummary {
  return {
    id: raw.id,
    givenName: raw.given_name,
    familyName: raw.family_name,
    idNumber: raw.id_number ?? null,
    civilianId: raw.civilian_id ?? null,
    rank: raw.rank ?? null,
    status: raw.status as SoldierStatus,
    profileImage: raw.profile_image ?? null,
    phone: raw.phone ?? null,
    gapCount,
    openRequestCount,
    approvedRequests,
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
  const noAccess = rawRole === "instructor" || rawRole === "company_medic" || rawRole === "hardship_coordinator";

  // -------- PowerSync queries --------
  const queryParams = useMemo(() => [selectedCycleId ?? ""], [selectedCycleId]);
  const { data: rawSoldiers, isLoading: soldiersLoading } = useTrackedQuery<RawSoldier>("soldiers.SOLDIERS", SOLDIERS_QUERY, queryParams);
  const { data: rawSquads } = useTrackedQuery<RawSquad>("soldiers.SQUADS", SQUADS_QUERY, queryParams);
  const { data: rawOpenRequests } = useTrackedQuery<RawOpenRequest>("soldiers.OPEN_REQUESTS", OPEN_REQUESTS_QUERY, queryParams);
  const { data: rawHardshipRequests } = useTrackedQuery<RawHardshipRequest>("soldiers.HARDSHIP", HARDSHIP_REQUESTS_QUERY, queryParams);
  const { data: rawGapCounts } = useTrackedQuery<RawGapCount>("soldiers.GAP_COUNT", GAP_COUNT_QUERY, queryParams);
  const { data: rawOpenRequestCounts } = useTrackedQuery<RawOpenRequestCount>("soldiers.OPEN_REQ_COUNT", OPEN_REQUEST_COUNT_QUERY, queryParams);
  const { showLoading, showConnectionError } = useSyncReady(
    (rawSoldiers ?? []).length > 0,
    soldiersLoading
  );

  usePagePerf("soldiers", (rawSoldiers ?? []).length > 0);

  // Build soldier → hardship set (for the hardship filter)
  const hardshipSoldierIds = useMemo(() => {
    const set = new Set<string>();
    for (const hr of rawHardshipRequests ?? []) set.add(hr.soldier_id);
    return set;
  }, [rawHardshipRequests]);

  const allSquads: SquadData[] = useMemo(() => {
    // Build soldier → approved requests map (with urgency info).
    // Filter the raw candidate set (cycle's open + approved-leave/medical) down to
    // currently-open requests via the shared isRequestOpen() helper.
    type ApprovedReq = { type: RequestType; urgent: boolean };
    const approvedMap = new Map<string, ApprovedReq[]>();
    for (const ar of rawOpenRequests ?? []) {
      if (!isRequestOpen({
        status: ar.status,
        type: ar.type,
        departureAt: ar.departure_at,
        returnAt: ar.return_at,
        medicalAppointments: ar.medical_appointments,
        sickDays: ar.sick_days,
      })) continue;
      const entry: ApprovedReq = {
        type: ar.type as RequestType,
        urgent: ar.type === "medical" && ar.urgent === 1,
      };
      const list = approvedMap.get(ar.soldier_id);
      if (list) list.push(entry);
      else approvedMap.set(ar.soldier_id, [entry]);
    }
    // Add hardship entries from the separate query
    for (const hr of rawHardshipRequests ?? []) {
      const entry: ApprovedReq = {
        type: "hardship" as RequestType,
        urgent: (hr.special_conditions === 1 || hr.urgent === 1),
      };
      const list = approvedMap.get(hr.soldier_id);
      if (list) list.push(entry);
      else approvedMap.set(hr.soldier_id, [entry]);
    }

    // Build soldier → gap count map
    const gapMap = new Map<string, number>();
    for (const g of rawGapCounts ?? []) {
      gapMap.set(g.soldier_id, Number(g.gap_count));
    }

    // Build soldier → open request count map
    const openReqMap = new Map<string, number>();
    for (const r of rawOpenRequestCounts ?? []) {
      openReqMap.set(r.soldier_id, Number(r.open_request_count));
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
      if (squad) squad.soldiers.push(mapSoldier(s, approvedMap.get(s.id) ?? [], gapMap.get(s.id) ?? 0, openReqMap.get(s.id) ?? 0));
    }
    let squads = Array.from(squadMap.values()).filter((sq) => sq.soldiers.length > 0);
    // Squad commanders see only their own squad
    if (role === "squad_commander" && selectedAssignment?.unitId) {
      squads = squads.filter((sq) => sq.id === selectedAssignment.unitId);
    }
    return squads;
  }, [rawSoldiers, rawSquads, rawOpenRequests, rawHardshipRequests, rawGapCounts, rawOpenRequestCounts, role, selectedAssignment?.unitId]);

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
  type SoldierFilter = "gaps" | "requests" | "hardship" | null;
  const [activeFilter, setActiveFilter] = useState<SoldierFilter>(() => {
    const f = searchParams.get("filter");
    if (f === "gaps" || f === "requests" || f === "hardship") return f;
    return null;
  });
  const showGapsOnly = activeFilter === "gaps";
  const showRequestsOnly = activeFilter === "requests";
  const showHardshipOnly = activeFilter === "hardship";

  function toggleFilter(f: SoldierFilter) {
    setActiveFilter((prev) => (prev === f ? null : f));
  }

  // Sync filter to URL so browser back button preserves it
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const current = params.get("filter");
    if (current === activeFilter) return;
    if (activeFilter) params.set("filter", activeFilter);
    else params.delete("filter");
    const qs = params.toString();
    router.replace(`/soldiers${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [activeFilter]);
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
          if (showRequestsOnly && s.openRequestCount === 0 && !s.approvedRequests.some((r) => r.type !== "hardship")) return false;
          if (showHardshipOnly && !hardshipSoldierIds.has(s.id)) return false;
          if (search.trim()) {
            const q = search.trim().toLowerCase();
            const fullName = `${s.familyName} ${s.givenName}`.toLowerCase();
            const matchesName = fullName.includes(q);
            const matchesId = s.idNumber?.includes(q) ?? false;
            const matchesCivilianId = s.civilianId?.includes(q) ?? false;
            const matchesPhone = s.phone?.includes(q) ?? false;
            if (!matchesName && !matchesId && !matchesCivilianId && !matchesPhone) return false;
          }
          return true;
        }),
      }))
      .filter((sq) => sq.soldiers.length > 0);
  }, [allSquads, statusFilter, showGapsOnly, showRequestsOnly, showHardshipOnly, hardshipSoldierIds, search]);

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
    if (created > 0) parts.push(`${hebrewCount(created, "חייל נוסף", "חיילים נוספו")}`);
    if (updated > 0) parts.push(`${hebrewCount(updated, "חייל עודכן", "חיילים עודכנו")}`);
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
    role === "squad_commander" && selectedAssignment?.unitId
      ? selectedAssignment.unitId
      : undefined;

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky top search + gaps filter */}
      <div ref={stickyBarRef} className="sticky z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2" style={{ top: "var(--app-header-height, 0px)" }}>
        <div className="flex items-center gap-2">
          <SearchInput
            data-tour="soldiers-search"
            containerClassName="flex-1"
            placeholder="חיפוש לפי שם, מ״א או טלפון..."
            value={search}
            onValueChange={setSearch}
          />
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
        <div className="flex flex-wrap items-center gap-2">
          <div data-tour="soldiers-status-filters" className="flex gap-1.5 flex-1 md:flex-none">
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
          <div className="hidden md:flex-1 md:block" />
          <div className="flex items-center gap-2">
          <button
            data-tour="soldiers-requests-filter"
            type="button"
            onClick={() => toggleFilter("requests")}
            className={cn(
              "shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              showRequestsOnly
                ? "bg-amber-100 text-amber-800"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <FileText size={12} />
            <span>בקשות פתוחות</span>
          </button>
          <button
            type="button"
            onClick={() => toggleFilter("hardship")}
            className={cn(
              "shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              showHardshipOnly
                ? "bg-purple-100 text-purple-800"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <HeartHandshake size={12} />
            <span>ת״ש</span>
          </button>
          <button
            data-tour="soldiers-gaps-filter"
            type="button"
            onClick={() => toggleFilter("gaps")}
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
      </div>

      {/* Content */}
      <div className="pb-32">
        {totalSoldiers === 0 && showLoading && !search && (statusFilter === "all" || statusFilter === "active") && !showGapsOnly && !showRequestsOnly && !showHardshipOnly && (
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
        {totalSoldiers === 0 && showConnectionError && !search && (statusFilter === "all" || statusFilter === "active") && !showGapsOnly && !showRequestsOnly && !showHardshipOnly && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
            <p className="font-medium">לא ניתן לטעון נתונים</p>
            <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
          </div>
        )}
        {totalSoldiers === 0 && !showLoading && !showConnectionError && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <p className="font-medium">אין חיילים</p>
            {(search || (statusFilter !== "all" && statusFilter !== "active") || showGapsOnly || showRequestsOnly || showHardshipOnly) && (
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
        data-tour="soldiers-import-btn"
        type="button"
        onClick={() => setImportOpen(true)}
        className="md:hidden fixed bottom-20 end-20 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg transition-transform active:scale-95"
        aria-label="ייבוא חיילים"
      >
        <FileUp size={20} />
      </button>
      <button
        data-tour="soldiers-add-btn"
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
              {lateJoinerInfo?.count === 1
                ? "קיימת פעילות פעילה 1 לחייל. לסמן כ-לא רלוונטי?"
                : `קיימות ${lateJoinerInfo?.count} פעילויות פעילות לחייל. לסמן כ-לא רלוונטי?`}
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
