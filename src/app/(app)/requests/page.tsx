"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Bell, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
import { usePowerSync } from "@powersync/react";
import { useSyncReady } from "@/hooks/useSyncReady";
import { RequestCard, type RequestSummary } from "@/components/requests/RequestCard";
import { CreateRequestForm } from "@/components/requests/CreateRequestForm";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REQUEST_TYPE_LABELS } from "@/lib/requests/constants";
import { RequestTypeIcon } from "@/components/requests/RequestTypeIcon";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { RequestType, RequestStatus, Role } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { requestsTourSteps } from "@/lib/tour/steps";
import { canActOnRequest, getAvailableActions, getNextState } from "@/lib/requests/workflow";
import { parseMedicalAppointments, formatAppointment } from "@/lib/requests/medical-appointments";
import { isRequestActive } from "@/lib/requests/active";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewTab = "open" | "active" | "approved" | "mine";

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const REQUESTS_QUERY = `
  SELECT
    r.id, r.type, r.status, r.assigned_role, r.description, r.urgent, r.special_conditions,
    r.created_at, r.departure_at, r.return_at, r.medical_appointments,
    s.family_name || ' ' || s.given_name AS soldier_name,
    s.squad_id,
    sq.name AS squad_name,
    sq.platoon_id
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  JOIN squads sq ON sq.id = s.squad_id
  WHERE r.cycle_id = ?
  ORDER BY r.created_at DESC
`;

interface RawRequest {
  id: string;
  type: string;
  status: string;
  assigned_role: string | null;
  description: string | null;
  urgent: number | null;
  special_conditions: number | null;
  created_at: string;
  departure_at: string | null;
  return_at: string | null;
  medical_appointments: string | null;
  soldier_name: string;
  squad_id: string;
  squad_name: string;
  platoon_id: string;
}

function mapRequest(raw: RawRequest): RequestSummary {
  return {
    id: raw.id,
    type: raw.type as RequestType,
    status: raw.status as RequestStatus,
    assignedRole: (raw.assigned_role as Role) ?? null,
    soldierName: raw.soldier_name,
    squadId: raw.squad_id,
    squadName: raw.squad_name,
    platoonId: raw.platoon_id,
    createdAt: raw.created_at,
    description: raw.description,
    urgent: raw.urgent != null ? Boolean(raw.urgent) : null,
    specialConditions: raw.special_conditions != null ? Boolean(raw.special_conditions) : null,
    departureAt: raw.departure_at,
    returnAt: raw.return_at,
    medicalAppointments: raw.medical_appointments,
  };
}

function isActiveRequest(r: RequestSummary, today: string): boolean {
  return isRequestActive(r, today);
}

/** Sort key for active requests: soonest relevant date first. */
function activeRequestSortDate(r: RequestSummary): string {
  if (r.type === "leave") {
    return r.departureAt?.split("T")[0] ?? r.returnAt?.split("T")[0] ?? "9999";
  }
  if (r.type === "medical") {
    const today = new Date().toISOString().split("T")[0];
    const appts = parseMedicalAppointments(r.medicalAppointments);
    const next = appts.find((a) => a.date.split("T")[0] >= today);
    return next?.date.split("T")[0] ?? "9999";
  }
  return "9999";
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("he-IL", { day: "numeric", month: "short" });
  const hasTime = iso.includes("T") && !iso.endsWith("T00:00:00.000Z");
  if (hasTime) {
    const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
  }
  return date;
}

/** Brief explanation of why a request appears on a given date in the active tab. */
function activeRequestDetail(r: RequestSummary): string | null {
  if (r.type === "leave") {
    const dep = r.departureAt;
    const ret = r.returnAt;
    if (dep && ret) return `יציאה ${formatShortDate(dep)} · חזרה ${formatShortDate(ret)}`;
    if (dep) return `יציאה ${formatShortDate(dep)}`;
    if (ret) return `חזרה ${formatShortDate(ret)}`;
    return null;
  }
  if (r.type === "medical") {
    const today = new Date().toISOString().split("T")[0];
    const appts = parseMedicalAppointments(r.medicalAppointments);
    const next = appts.find((a) => a.date >= today);
    if (next) return `תור: ${formatAppointment(next)}`;
    return null;
  }
  return null;
}

function groupByDate(requests: RequestSummary[]): [string, RequestSummary[]][] {
  const groups = new Map<string, RequestSummary[]>();
  for (const r of requests) {
    const key = activeRequestSortDate(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return Array.from(groups.entries());
}

function formatGroupDate(dateKey: string): string {
  if (dateKey === "9999") return "אחר";
  const d = new Date(dateKey.includes("T") ? dateKey : dateKey + "T00:00:00");
  return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  approve: "אשר",
  deny: "דחה",
  acknowledge: "אשר קבלה",
};

export default function RequestsPage() {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const router = useRouter();
  const searchParams = useSearchParams();
  const db = usePowerSync();
  const { data: session } = useSession();
  const rawRole = (selectedAssignment?.role ?? "") as Role | "";
  const role = rawRole ? effectiveRole(rawRole) : "";
  const canCreate = role === "squad_commander" || role === "platoon_commander" || rawRole === "company_medic" || rawRole === "hardship_coordinator";

  // -------- Sticky header offsets --------
  // AppShell publishes --app-header-height as a CSS variable.
  // The page header uses that variable directly via inline style.
  // Date-group sub-headers use CSS calc() combining the reactive variable
  // with the JS-measured page header height — avoids timing issues where
  // the child effect fires before the parent sets the CSS variable.
  const headerRef = useRef<HTMLDivElement>(null);
  const [pageHeaderH, setPageHeaderH] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const queryParams = useMemo(() => [selectedCycleId ?? ""], [selectedCycleId]);
  const { data: rawRequests, isLoading: requestsLoading } = useQuery<RawRequest>(REQUESTS_QUERY, queryParams);
  const { showLoading, showEmpty, showConnectionError } = useSyncReady(
    (rawRequests ?? []).length > 0,
    requestsLoading
  );

  const isMedic = rawRole === "company_medic";
  const isCoordinator = rawRole === "hardship_coordinator";
  const isTypeRestricted = isMedic || isCoordinator;

  const allRequests = useMemo(() => {
    let mapped = (rawRequests ?? []).map(mapRequest);
    if (isMedic) mapped = mapped.filter((r) => r.type === "medical");
    if (isCoordinator) mapped = mapped.filter((r) => r.type === "hardship");
    const unitId = selectedAssignment?.unitId;
    if (!unitId || !role) return mapped;
    if (role === "squad_commander") {
      return mapped.filter((r) => r.squadId === unitId);
    }
    if (role === "platoon_commander") {
      return mapped.filter((r) => r.platoonId === unitId);
    }
    return mapped;
  }, [rawRequests, role, selectedAssignment?.unitId, isMedic, isCoordinator]);

  // UI state — initialise from URL params
  const [viewTab, setViewTab] = useState<ViewTab>(() => {
    const filter = searchParams.get("filter");
    const tab = searchParams.get("tab");
    if (filter === "mine") return "mine";
    if (filter === "active" || tab === "active") return "active";
    return "open";
  });
  const [filterType, setFilterType] = useState<RequestType | "all">("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [createType, setCreateType] = useState<RequestType | null>(null);

  // Filtered lists
  const openRequests = useMemo(
    () => allRequests.filter((r) => r.status === "open" && (filterType === "all" || r.type === filterType)),
    [allRequests, filterType],
  );

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const activeRequests = useMemo(
    () =>
      allRequests
        .filter((r) => isActiveRequest(r, today) && (filterType === "all" || r.type === filterType))
        .sort((a, b) => activeRequestSortDate(a).localeCompare(activeRequestSortDate(b))),
    [allRequests, filterType, today],
  );

  const approvedRequests = useMemo(
    () =>
      allRequests
        .filter((r) => r.status === "approved" && (filterType === "all" || r.type === filterType))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allRequests, filterType],
  );

  // Sort open: assigned to me first
  const sortedOpen = useMemo(() => {
    if (!rawRole) return openRequests;
    return [...openRequests].sort((a, b) => {
      const aMe = a.assignedRole !== null && canActOnRequest(rawRole as Role, a.assignedRole) ? 0 : 1;
      const bMe = b.assignedRole !== null && canActOnRequest(rawRole as Role, b.assignedRole) ? 0 : 1;
      return aMe - bMe;
    });
  }, [openRequests, rawRole]);

  // "Requires my action" — all requests assigned to current user (open + approved pending ack)
  const mineRequests = useMemo(() => {
    if (!rawRole) return [];
    return allRequests.filter(
      (r) => r.assignedRole !== null && canActOnRequest(rawRole as Role, r.assignedRole) && (filterType === "all" || r.type === filterType),
    );
  }, [allRequests, rawRole, filterType]);

  function handleTypeSelect(type: RequestType) {
    setTypeMenuOpen(false);
    setCreateType(type);
  }

  function handleCreateSuccess(_requestId: string) {
    setCreateType(null);
    toast.success("הבקשה נוצרה בהצלחה");
  }

  // --- Context menu / quick actions ---
  const [ctxMenu, setCtxMenu] = useState<{ position: { x: number; y: number }; request: RequestSummary } | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogAction, setNoteDialogAction] = useState<"approve" | "deny">("approve");
  const [actionNote, setActionNote] = useState("");
  const [actionRequest, setActionRequest] = useState<RequestSummary | null>(null);
  const [acting, setActing] = useState(false);

  const userName = session?.user
    ? `${(session.user as { familyName?: string }).familyName ?? ""} ${(session.user as { givenName?: string }).givenName ?? ""}`.trim()
    : "";

  async function insertAction(requestId: string, action: string, note: string | null) {
    const actionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO request_actions (id, request_id, user_id, action, note, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [actionId, requestId, session?.user?.id ?? "", action, note, userName, now],
    );
  }

  async function executeAction(request: RequestSummary, action: "approve" | "deny" | "acknowledge", note: string | null) {
    if (!request.assignedRole) return;
    const transition = getNextState(request.status, request.assignedRole, action, request.type);
    if (!transition) return;

    setActing(true);
    try {
      await db.execute(
        `UPDATE requests SET status = ?, assigned_role = ?, updated_at = ? WHERE id = ?`,
        [transition.newStatus, transition.newAssignedRole, new Date().toISOString(), request.id],
      );
      await insertAction(request.id, action, note);
      const messages: Record<string, string> = {
        approve: "הבקשה אושרה",
        deny: "הבקשה נדחתה",
        acknowledge: "הבקשה התקבלה",
      };
      toast.success(messages[action]);
    } catch {
      toast.error("שגיאה בביצוע הפעולה");
    } finally {
      setActing(false);
    }
  }

  const handleLongPress = useCallback((request: RequestSummary, pos: { x: number; y: number }) => {
    if (!rawRole || isTypeRestricted) return;
    const actions = request.assignedRole
      ? getAvailableActions(request.status, request.assignedRole, rawRole as Role, request.type)
      : [];
    if (actions.length === 0) return;
    setCtxMenu({ position: pos, request });
  }, [rawRole]);

  function getContextMenuItems(request: RequestSummary): ContextMenuItem[] {
    if (!rawRole || isTypeRestricted) return [];
    const actions = request.assignedRole
      ? getAvailableActions(request.status, request.assignedRole, rawRole as Role, request.type)
      : [];
    return actions.map((action) => ({
      label: ACTION_LABELS[action] ?? action,
      destructive: action === "deny",
      onClick: () => {
        if (action === "acknowledge") {
          executeAction(request, action, null);
        } else {
          setActionRequest(request);
          setActionNote("");
          setNoteDialogAction(action);
          setNoteDialogOpen(true);
        }
      },
    }));
  }

  function confirmActionWithNote() {
    if (!actionRequest) return;
    executeAction(actionRequest, noteDialogAction, actionNote.trim() || null);
    setNoteDialogOpen(false);
    setActionRequest(null);
  }

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "requests", steps: requestsTourSteps });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  if (rawRole === "instructor") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">אין גישה לעמוד זה</p>
        <p className="text-muted-foreground text-sm">עמוד הבקשות אינו זמין עבור תפקיד זה.</p>
      </div>
    );
  }

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
        <p className="text-muted-foreground text-sm">בחר מחזור פעיל כדי לצפות בבקשות.</p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div ref={headerRef} className="sticky z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2" style={{ top: "var(--app-header-height, 0px)" }}>
        <div className="flex items-center gap-1.5">
          {/* View tabs */}
          <button
            data-tour="requests-tab-open"
            type="button"
            onClick={() => setViewTab("open")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              viewTab === "open"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            ממתינות
            {openRequests.length > 0 && <span className="mr-1">({openRequests.length})</span>}
          </button>

          <button
            data-tour="requests-tab-active"
            type="button"
            onClick={() => setViewTab("active")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              viewTab === "active"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            פעילות
            {activeRequests.length > 0 && <span className="mr-1">({activeRequests.length})</span>}
          </button>

          <button
            type="button"
            onClick={() => setViewTab("approved")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              viewTab === "approved"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            אושרו
            {approvedRequests.length > 0 && <span className="mr-1">({approvedRequests.length})</span>}
          </button>

          {role && !isTypeRestricted && (
            <button
              data-tour="requests-tab-mine"
              type="button"
              onClick={() => setViewTab("mine")}
              className={cn(
                "shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                viewTab === "mine"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-800/60 dark:text-amber-100"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <Bell size={12} />
              <span>דורשות טיפולי</span>
              {mineRequests.length > 0 && <span className="mr-1">({mineRequests.length})</span>}
            </button>
          )}

          {canCreate && (
            <button
              data-tour="requests-add-btn"
              type="button"
              onClick={() => isTypeRestricted ? setCreateType(isMedic ? "medical" : "hardship") : setTypeMenuOpen(true)}
              className="hidden md:flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shrink-0 ms-auto"
            >
              <Plus size={15} /> {isMedic ? "בקשה רפואית חדשה" : isCoordinator ? 'בקשת ת"ש חדשה' : "בקשה חדשה"}
            </button>
          )}
        </div>
        {!isTypeRestricted && <div data-tour="requests-type-filters" className="flex items-center gap-1.5">
          {(["all", "leave", "medical", "hardship"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filterType === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all" ? "הכל" : REQUEST_TYPE_LABELS[t]}
            </button>
          ))}
        </div>}
      </div>

      {/* Content */}
      <div className="pb-32">
        {/* Open requests */}
        {viewTab === "open" && (
          <>
            {sortedOpen.length === 0 && showLoading && (
              <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
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
            {sortedOpen.length === 0 && showConnectionError && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
                <p className="font-medium">לא ניתן לטעון נתונים</p>
                <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
              </div>
            )}
            {sortedOpen.length === 0 && !showLoading && !showConnectionError && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <p className="font-medium">אין בקשות ממתינות</p>
                {canCreate && (
                  <p className="text-sm text-muted-foreground">לחץ על + כדי ליצור בקשה חדשה</p>
                )}
              </div>
            )}
            {sortedOpen.length > 0 && (
              <div className="divide-y divide-border">
                {sortedOpen.map((r, i) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    userRole={rawRole as Role}
                    onClick={() => router.push(`/requests/${r.id}`)}
                    onLongPress={(pos) => handleLongPress(r, pos)}
                    dataTour={i === 0 ? "requests-card" : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Requires my action */}
        {viewTab === "mine" && (
          <>
            {mineRequests.length === 0 && !showLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <p className="font-medium">אין בקשות הדורשות טיפולך</p>
              </div>
            )}
            {mineRequests.length > 0 && (
              <div className="divide-y divide-border">
                {mineRequests.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    userRole={rawRole as Role}
                    onClick={() => router.push(`/requests/${r.id}`)}
                    onLongPress={(pos) => handleLongPress(r, pos)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Active requests */}
        {viewTab === "approved" && (
          <>
            {approvedRequests.length === 0 && !showLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <p className="font-medium">אין בקשות שאושרו</p>
              </div>
            )}
            {approvedRequests.length > 0 && (
              <div className="divide-y divide-border">
                {approvedRequests.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    userRole={rawRole as Role}
                    onClick={() => router.push(`/requests/${r.id}`)}
                    onLongPress={(pos) => handleLongPress(r, pos)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {viewTab === "active" && (
          <>
            {activeRequests.length === 0 && !showLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <p className="font-medium">אין בקשות פעילות</p>
              </div>
            )}
            {activeRequests.length > 0 && (
              <div>
                {groupByDate(activeRequests).map(([dateKey, requests]) => (
                  <div key={dateKey}>
                    <div className="sticky z-10 bg-muted/80 backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-muted-foreground" style={{ top: `calc(var(--app-header-height, 0px) + ${pageHeaderH}px)` }}>
                      {formatGroupDate(dateKey)}
                    </div>
                    <div className="divide-y divide-border">
                      {requests.map((r) => (
                        <RequestCard
                          key={r.id}
                          request={r}
                          userRole={rawRole as Role}
                          activeDetail={activeRequestDetail(r)}
                          onClick={() => router.push(`/requests/${r.id}`)}
                          onLongPress={(pos) => handleLongPress(r, pos)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile FAB */}
      {canCreate && (
        <button
          data-tour="requests-add-btn"
          type="button"
          onClick={() => isMedic ? setCreateType("medical") : setTypeMenuOpen(true)}
          className="md:hidden fixed bottom-20 end-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          aria-label="בקשה חדשה"
        >
          <Plus size={24} />
        </button>
      )}

      {/* Type selection dialog */}
      <Dialog open={typeMenuOpen} onOpenChange={setTypeMenuOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>בחר סוג בקשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {(isMedic ? ["medical"] as RequestType[] : isCoordinator ? ["hardship"] as RequestType[] : ["leave", "medical", "hardship"] as RequestType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleTypeSelect(type)}
                className="flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-start hover:bg-muted transition-colors"
              >
                <RequestTypeIcon type={type} size={20} />
                <span className="text-sm font-medium">{REQUEST_TYPE_LABELS[type]}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create request dialog */}
      <Dialog open={!!createType} onOpenChange={(open) => { if (!open) setCreateType(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {createType && (
                <>
                  <RequestTypeIcon type={createType} size={18} className="ml-2 inline" />
                  {REQUEST_TYPE_LABELS[createType]}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {createType && selectedCycleId && rawRole && selectedAssignment && (
            <CreateRequestForm
              cycleId={selectedCycleId}
              requestType={createType}
              userRole={rawRole as Role}
              unitId={selectedAssignment.unitId}
              onSuccess={handleCreateSuccess}
              onCancel={() => setCreateType(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Context menu for quick actions */}
      {ctxMenu && (
        <ContextMenu
          items={getContextMenuItems(ctxMenu.request)}
          position={ctxMenu.position}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Note dialog for approve/deny */}
      <Dialog open={noteDialogOpen} onOpenChange={(open) => { if (!open) { setNoteDialogOpen(false); setActionRequest(null); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{noteDialogAction === "approve" ? "אישור בקשה" : "דחיית בקשה"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionRequest && (
              <p className="text-sm text-muted-foreground">
                {actionRequest.soldierName} · {REQUEST_TYPE_LABELS[actionRequest.type]}
              </p>
            )}
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="הערה (אופציונלי)"
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
            />
            <div className="flex flex-row-reverse gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setNoteDialogOpen(false); setActionRequest(null); }}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={confirmActionWithNote}
                disabled={acting}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium text-white transition-colors",
                  noteDialogAction === "deny"
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-emerald-600 hover:bg-emerald-700",
                )}
              >
                {noteDialogAction === "approve" ? "אשר" : "דחה"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
