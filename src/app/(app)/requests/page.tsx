"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Bell } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import { useQuery } from "@powersync/react";
import { useSafeStatus as useStatus } from "@/hooks/useSafeStatus";
import { RequestCard, type RequestSummary } from "@/components/requests/RequestCard";
import { CreateRequestForm } from "@/components/requests/CreateRequestForm";
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
import { canActOnRequest } from "@/lib/requests/workflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewTab = "open" | "approved";

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const REQUESTS_QUERY = `
  SELECT
    r.id, r.type, r.status, r.assigned_role, r.description, r.urgent,
    r.created_at,
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
  created_at: string;
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
  };
}

function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function RequestsPage() {
  const { selectedCycleId, selectedAssignment } = useCycle();
  const router = useRouter();
  const searchParams = useSearchParams();
  const syncStatus = useStatus();
  const rawRole = (selectedAssignment?.role ?? "") as Role | "";
  const role = rawRole ? effectiveRole(rawRole) : "";
  const canCreate = role === "squad_commander" || role === "platoon_commander";

  const queryParams = useMemo(() => [selectedCycleId ?? ""], [selectedCycleId]);
  const { data: rawRequests } = useQuery<RawRequest>(REQUESTS_QUERY, queryParams);

  const allRequests = useMemo(() => {
    const mapped = (rawRequests ?? []).map(mapRequest);
    const unitId = selectedAssignment?.unitId;
    if (!unitId || !role) return mapped;
    if (role === "squad_commander") {
      return mapped.filter((r) => r.squadId === unitId);
    }
    if (role === "platoon_commander") {
      return mapped.filter((r) => r.platoonId === unitId);
    }
    return mapped;
  }, [rawRequests, role, selectedAssignment?.unitId]);

  // UI state — initialise from URL params
  const [viewTab, setViewTab] = useState<ViewTab>(
    searchParams.get("tab") === "approved" ? "approved" : "open"
  );
  const [showMineOnly, setShowMineOnly] = useState(
    searchParams.get("filter") === "mine"
  );
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [createType, setCreateType] = useState<RequestType | null>(null);

  // Filtered lists
  const openRequests = useMemo(
    () => allRequests.filter((r) => r.assignedRole !== null),
    [allRequests],
  );

  const approvedRequests = useMemo(
    () => allRequests.filter((r) => r.status === "approved" && r.assignedRole === null),
    [allRequests],
  );

  // Group approved by day
  const approvedByDay = useMemo(() => {
    const groups = new Map<string, RequestSummary[]>();
    for (const r of approvedRequests) {
      const day = r.createdAt.split("T")[0];
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [approvedRequests]);

  // Sort open: assigned to me first; optionally filter to mine only
  const sortedOpen = useMemo(() => {
    let list = openRequests;
    if (showMineOnly && rawRole) {
      list = list.filter((r) => r.assignedRole !== null && canActOnRequest(rawRole as Role, r.assignedRole));
    }
    if (!rawRole) return list;
    return [...list].sort((a, b) => {
      const aMe = a.assignedRole !== null && canActOnRequest(rawRole as Role, a.assignedRole) ? 0 : 1;
      const bMe = b.assignedRole !== null && canActOnRequest(rawRole as Role, b.assignedRole) ? 0 : 1;
      return aMe - bMe;
    });
  }, [openRequests, rawRole, showMineOnly]);

  function handleTypeSelect(type: RequestType) {
    setTypeMenuOpen(false);
    setCreateType(type);
  }

  function handleCreateSuccess(_requestId: string) {
    setCreateType(null);
    toast.success("הבקשה נוצרה בהצלחה");
  }

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
        <p className="text-muted-foreground text-sm">בחר מחזור פעיל כדי לצפות בבקשות.</p>
      </div>
    );
  }

  const displayList = viewTab === "open" ? sortedOpen : [];

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          {/* View tabs */}
          <div className="flex gap-1.5 flex-1">
            {(["open", "approved"] as ViewTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setViewTab(tab)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  viewTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "open" ? "פתוחות" : "אושרו"}
                {tab === "open" && openRequests.length > 0 && (
                  <span className="mr-1">({openRequests.length})</span>
                )}
                {tab === "approved" && approvedRequests.length > 0 && (
                  <span className="mr-1">({approvedRequests.length})</span>
                )}
              </button>
            ))}
          </div>

          {canCreate && (
            <button
              type="button"
              onClick={() => setTypeMenuOpen(true)}
              className="hidden md:flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              <Plus size={15} /> בקשה חדשה
            </button>
          )}
        </div>
        {viewTab === "open" && role && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowMineOnly((v) => !v)}
              className={cn(
                "shrink-0 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                showMineOnly
                  ? "bg-amber-100 text-amber-800"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <Bell size={12} />
              <span>דורשות טיפולי</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="pb-32">
        {/* Open requests */}
        {viewTab === "open" && (
          <>
            {displayList.length === 0 && !syncStatus.hasSynced && (
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
            {displayList.length === 0 && syncStatus.hasSynced && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <p className="font-medium">אין בקשות פתוחות</p>
                {canCreate && (
                  <p className="text-sm text-muted-foreground">לחץ על + כדי ליצור בקשה חדשה</p>
                )}
              </div>
            )}
            {displayList.length > 0 && (
              <div className="divide-y divide-border">
                {displayList.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    userRole={rawRole as Role}
                    onClick={() => router.push(`/requests/${r.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Approved requests grouped by day */}
        {viewTab === "approved" && (
          <>
            {approvedByDay.length === 0 && syncStatus.hasSynced && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <p className="font-medium">אין בקשות שאושרו</p>
              </div>
            )}
            {approvedByDay.map(([day, requests]) => (
              <div key={day}>
                <div className="sticky top-[52px] z-10 bg-muted/80 backdrop-blur-sm px-4 py-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {formatDayHeader(day)}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {requests.map((r) => (
                    <RequestCard
                      key={r.id}
                      request={r}
                      userRole={rawRole as Role}
                      onClick={() => router.push(`/requests/${r.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Mobile FAB */}
      {canCreate && (
        <button
          type="button"
          onClick={() => setTypeMenuOpen(true)}
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
            {(["leave", "medical", "hardship"] as RequestType[]).map((type) => (
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
    </div>
  );
}
