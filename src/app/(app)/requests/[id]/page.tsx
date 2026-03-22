"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowRight, Check, X, Bell } from "lucide-react";
import { toast } from "sonner";
import { usePowerSync, useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  REQUEST_TYPE_LABELS,
  REQUEST_TYPE_ICONS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_VARIANT,
  ASSIGNED_ROLE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/requests/constants";
import { getAvailableActions, getNextState } from "@/lib/requests/workflow";
import type { RequestType, RequestStatus, Role, Transportation } from "@/types";

// ---------------------------------------------------------------------------
// SQL queries
// ---------------------------------------------------------------------------

const REQUEST_QUERY = `
  SELECT
    r.*,
    s.given_name AS soldier_given_name,
    s.family_name AS soldier_family_name,
    sq.name AS squad_name,
    p.name AS platoon_name
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  WHERE r.id = ?
`;

// Resolve user's role for this request's cycle from local user_cycle_assignments
// We don't have user_cycle_assignments in PowerSync. Use the CycleContext instead.

interface RawRequest {
  id: string;
  cycle_id: string;
  soldier_id: string;
  type: string;
  status: string;
  assigned_role: string | null;
  created_by_user_id: string;
  description: string | null;
  place: string | null;
  departure_at: string | null;
  return_at: string | null;
  transportation: string | null;
  urgent: number | null;
  paramedic_date: string | null;
  appointment_date: string | null;
  appointment_place: string | null;
  appointment_type: string | null;
  sick_leave_days: number | null;
  special_conditions: number | null;
  created_at: string;
  updated_at: string;
  soldier_given_name: string;
  soldier_family_name: string;
  squad_name: string;
  platoon_name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function RequestDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const db = usePowerSync();

  // App shell pattern: read real ID from URL
  const [requestId, setRequestId] = useState(params.id);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/requests\/([^/]+)$/);
    if (match && match[1] !== requestId) {
      setRequestId(match[1]);
    }
  }, []);

  // Grace period
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const requestParams = useMemo(() => [requestId], [requestId]);
  const { data: requestRows } = useQuery<RawRequest>(REQUEST_QUERY, requestParams);
  const raw = requestRows?.[0] ?? null;

  const { selectedAssignment } = useCycle();
  const userRole = (selectedAssignment?.role ?? "") as Role | "";

  const [acting, setActing] = useState(false);

  if (!raw && ready) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <p className="font-medium">בקשה לא נמצאה</p>
        <Button variant="outline" onClick={() => router.push("/requests")}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }

  if (!raw) return null;

  const requestType = raw.type as RequestType;
  const requestStatus = raw.status as RequestStatus;
  const assignedRole = raw.assigned_role as Role | null;

  const actions = userRole && assignedRole
    ? getAvailableActions(requestStatus, assignedRole, userRole as Role, requestType)
    : [];

  const isAssignedToMe = assignedRole !== null && userRole === assignedRole;

  async function handleAction(action: "approve" | "deny" | "acknowledge") {
    if (!assignedRole) return;
    const transition = getNextState(requestStatus, assignedRole, action, requestType);
    if (!transition) return;

    setActing(true);
    try {
      // Write directly to local PowerSync DB
      await db.execute(
        `UPDATE requests SET status = ?, assigned_role = ?, updated_at = ? WHERE id = ?`,
        [
          transition.newStatus,
          transition.newAssignedRole,
          new Date().toISOString(),
          raw.id,
        ],
      );

      const messages: Record<string, string> = {
        approve: "הבקשה אושרה",
        deny: "הבקשה נדחתה",
        acknowledge: "הבקשה הועברה",
      };
      toast.success(messages[action]);
    } catch {
      toast.error("שגיאה בביצוע הפעולה");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.push("/requests")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowRight size={16} />
        <span>חזרה</span>
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-xl">
              {REQUEST_TYPE_ICONS[requestType]}
            </span>
            <div>
              <h1 className="text-lg font-bold">{REQUEST_TYPE_LABELS[requestType]}</h1>
              <p className="text-sm text-muted-foreground">
                {raw.soldier_family_name} {raw.soldier_given_name} · {raw.squad_name}
              </p>
            </div>
          </div>
          <Badge variant={REQUEST_STATUS_VARIANT[requestStatus]}>
            {REQUEST_STATUS_LABELS[requestStatus]}
          </Badge>
        </div>

        {/* Assignment indicator */}
        {assignedRole && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              isAssignedToMe
                ? "bg-amber-50 text-amber-800 border border-amber-200"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {isAssignedToMe ? (
              <span className="flex items-center gap-2">
                <Bell size={14} />
                דורש טיפול שלך
              </span>
            ) : (
              `ממתין ל${ASSIGNED_ROLE_LABELS[assignedRole]}`
            )}
          </div>
        )}

        {!assignedRole && requestStatus === "approved" && (
          <div className="rounded-lg px-3 py-2 text-sm bg-emerald-50 text-emerald-800 border border-emerald-200">
            הטיפול בבקשה הושלם
          </div>
        )}

        {raw.urgent ? (
          <Badge variant="destructive">דחוף</Badge>
        ) : null}
      </div>

      {/* Details card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-1">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">פרטי הבקשה</h2>

        {raw.description && (
          <div className="py-2 border-b border-border">
            <p className="text-sm text-muted-foreground mb-1">תיאור</p>
            <p className="text-sm whitespace-pre-wrap">{raw.description}</p>
          </div>
        )}

        <DetailRow label="מחלקה" value={raw.platoon_name} />
        <DetailRow
          label="נוצר בתאריך"
          value={formatDateTime(raw.created_at)}
        />

        {/* Leave-specific */}
        {requestType === "leave" && (
          <>
            <DetailRow label="מקום" value={raw.place} />
            <DetailRow label="שעת יציאה" value={formatDateTime(raw.departure_at)} />
            <DetailRow label="שעת חזרה" value={formatDateTime(raw.return_at)} />
            <DetailRow
              label="דרך הגעה"
              value={
                raw.transportation
                  ? TRANSPORTATION_LABELS[raw.transportation as Transportation]
                  : null
              }
            />
          </>
        )}

        {/* Medical-specific */}
        {requestType === "medical" && (
          <>
            <DetailRow
              label='תאריך בדיקת חופ"ל'
              value={formatDate(raw.paramedic_date)}
            />
            <DetailRow label="תאריך תור" value={formatDate(raw.appointment_date)} />
            <DetailRow label="מקום התור" value={raw.appointment_place} />
            <DetailRow label="סוג התור" value={raw.appointment_type} />
            <DetailRow
              label="ימי גימלים"
              value={raw.sick_leave_days != null ? String(raw.sick_leave_days) : null}
            />
          </>
        )}

        {/* Hardship-specific */}
        {requestType === "hardship" && (
          <>
            <DetailRow
              label="אוכלוסיות מיוחדות"
              value={raw.special_conditions ? "כן" : "לא"}
            />
          </>
        )}
      </div>

      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex gap-2">
          {actions.includes("approve") && (
            <Button
              onClick={() => handleAction("approve")}
              disabled={acting}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              <Check size={16} className="ml-2" />
              אשר
            </Button>
          )}
          {actions.includes("deny") && (
            <Button
              variant="destructive"
              onClick={() => handleAction("deny")}
              disabled={acting}
              className="flex-1"
            >
              <X size={16} className="ml-2" />
              דחה
            </Button>
          )}
          {actions.includes("acknowledge") && (
            <Button
              onClick={() => handleAction("acknowledge")}
              disabled={acting}
              className="flex-1"
            >
              <Check size={16} className="ml-2" />
              קבלתי
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
