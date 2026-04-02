"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowRight, Check, X, Bell, Plus, ThumbsUp, ThumbsDown, Forward } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { usePowerSync, useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_VARIANT,
  ASSIGNED_ROLE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/requests/constants";
import { RequestTypeIcon } from "@/components/requests/RequestTypeIcon";
import { getAvailableActions, getNextState, canActOnRequest } from "@/lib/requests/workflow";
import type { RequestType, RequestStatus, Role, Transportation, RequestActionType } from "@/types";

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

const ACTIONS_QUERY = `
  SELECT id, action, note, user_name, created_at
  FROM request_actions
  WHERE request_id = ?
  ORDER BY created_at ASC
`;

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

interface RawAction {
  id: string;
  action: string;
  note: string | null;
  user_name: string;
  created_at: string;
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

const ACTION_LABELS: Record<RequestActionType, string> = {
  create: "נוצרה",
  approve: "אושרה",
  deny: "נדחתה",
  acknowledge: "אישר קבלה",
};

function ActionIcon({ action }: { action: string }) {
  const iconClass = "h-4 w-4";
  switch (action) {
    case "create":
      return <Plus className={`${iconClass} text-blue-500`} />;
    case "approve":
      return <ThumbsUp className={`${iconClass} text-emerald-500`} />;
    case "deny":
      return <ThumbsDown className={`${iconClass} text-red-500`} />;
    case "acknowledge":
      return <Forward className={`${iconClass} text-muted-foreground`} />;
    default:
      return <Plus className={`${iconClass} text-muted-foreground`} />;
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function RequestDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const db = usePowerSync();
  const { data: session } = useSession();

  // App shell pattern: read real ID from URL
  const [requestId, setRequestId] = useState(params.id);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/requests\/([^/]+)$/);
    if (match && match[1] !== requestId) {
      setRequestId(match[1]);
    }
  }, []);

  // Grace period: hard upper bound — if data arrives before it, we render immediately.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const requestParams = useMemo(() => [requestId], [requestId]);
  const { data: requestRows } = useQuery<RawRequest>(REQUEST_QUERY, requestParams);
  const raw = requestRows?.[0] ?? null;

  const { data: actionRows } = useQuery<RawAction>(ACTIONS_QUERY, requestParams);

  const { selectedAssignment } = useCycle();
  const rawUserRole = (selectedAssignment?.role ?? "") as Role | "";

  const [acting, setActing] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogAction, setNoteDialogAction] = useState<"approve" | "deny">("approve");
  const [actionNote, setActionNote] = useState("");

  if (!raw && timedOut) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <p className="font-medium">בקשה לא נמצאה</p>
        <Button variant="outline" onClick={() => router.push("/requests")}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }

  if (!raw) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const requestType = raw.type as RequestType;
  const requestStatus = raw.status as RequestStatus;
  const assignedRole = raw.assigned_role as Role | null;

  const actions = rawUserRole && assignedRole
    ? getAvailableActions(requestStatus, assignedRole, rawUserRole as Role, requestType)
    : [];

  const isAssignedToMe = assignedRole !== null && rawUserRole !== "" && canActOnRequest(rawUserRole as Role, assignedRole);

  const userName = session?.user
    ? `${(session.user as { familyName?: string }).familyName ?? ""} ${(session.user as { givenName?: string }).givenName ?? ""}`.trim()
    : "";

  function openNoteDialog(action: "approve" | "deny") {
    setActionNote("");
    setNoteDialogAction(action);
    setNoteDialogOpen(true);
  }

  async function insertAction(action: string, note: string | null) {
    const actionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO request_actions (id, request_id, user_id, action, note, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [actionId, raw.id, session?.user?.id ?? "", action, note, userName, now],
    );
  }

  async function handleAction(action: "approve" | "deny" | "acknowledge") {
    if (!assignedRole) return;
    const transition = getNextState(requestStatus, assignedRole, action, requestType);
    if (!transition) return;

    setActing(true);
    try {
      await db.execute(
        `UPDATE requests SET status = ?, assigned_role = ?, updated_at = ? WHERE id = ?`,
        [
          transition.newStatus,
          transition.newAssignedRole,
          new Date().toISOString(),
          raw.id,
        ],
      );
      await insertAction(action, null);

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

  async function confirmActionWithNote() {
    if (!assignedRole) return;
    const transition = getNextState(requestStatus, assignedRole, noteDialogAction, requestType);
    if (!transition) return;

    setActing(true);
    try {
      await db.execute(
        `UPDATE requests SET status = ?, assigned_role = ?, updated_at = ? WHERE id = ?`,
        [
          transition.newStatus,
          transition.newAssignedRole,
          new Date().toISOString(),
          raw.id,
        ],
      );
      await insertAction(noteDialogAction, actionNote.trim() || null);

      const messages: Record<string, string> = {
        approve: "הבקשה אושרה",
        deny: "הבקשה נדחתה",
      };
      toast.success(messages[noteDialogAction]);
      setNoteDialogOpen(false);
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
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <RequestTypeIcon type={requestType} size={20} />
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

      {/* Audit trail */}
      {actionRows && actionRows.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">מהלך הטיפול</h2>
          <div className="space-y-0">
            {actionRows.map((a, i) => (
              <div key={a.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <ActionIcon action={a.action} />
                  </div>
                  {i < actionRows.length - 1 && (
                    <div className="flex-1 w-px bg-border my-1" />
                  )}
                </div>
                <div className="pb-3 min-w-0">
                  <p className="text-sm font-medium">
                    {ACTION_LABELS[a.action as RequestActionType] ?? a.action}
                    {" · "}
                    <span className="text-muted-foreground font-normal">{a.user_name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(a.created_at)}
                  </p>
                  {a.note && (
                    <p className="text-sm mt-1 whitespace-pre-wrap text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                      {a.note}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex gap-2">
          {actions.includes("approve") && (
            <Button
              onClick={() => openNoteDialog("approve")}
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
              onClick={() => openNoteDialog("deny")}
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

      {/* Approve / Deny note dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {noteDialogAction === "approve" ? "אישור בקשה" : "דחיית בקשה"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">הערה (אופציונלי)</label>
            <textarea
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="הוסף הערה..."
              rows={3}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)} className="flex-1">
              ביטול
            </Button>
            {noteDialogAction === "approve" ? (
              <Button
                onClick={confirmActionWithNote}
                disabled={acting}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                אשר
              </Button>
            ) : (
              <Button variant="destructive" onClick={confirmActionWithNote} disabled={acting} className="flex-1">
                דחה
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
