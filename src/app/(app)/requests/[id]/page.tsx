"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowRight, Check, X, Bell, Plus, ThumbsUp, ThumbsDown, Forward, MessageSquare, Pencil, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { usePowerSync, useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";
import { useSyncReady } from "@/hooks/useSyncReady";
import { useGoBack } from "@/hooks/useGoBack";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { requestDetailTourSteps } from "@/lib/tour/steps";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { isRequestOpen, isRequestUrgent } from "@/lib/requests/active";
import { getAvailableActions, getNextState, canActOnRequest } from "@/lib/requests/workflow";
import { effectiveRole } from "@/lib/auth/permissions";
import { canEditRequest, canDeleteRequest } from "@/lib/requests/permissions";
import { formatAppointment, parseMedicalAppointments } from "@/lib/requests/medical-appointments";
import { parseSickDays } from "@/lib/requests/sick-days";
import { EditLeaveRequestForm } from "@/components/requests/EditLeaveRequestForm";
import { EditMedicalRequestForm } from "@/components/requests/EditMedicalRequestForm";
import { EditHardshipRequestForm } from "@/components/requests/EditHardshipRequestForm";
import { MedicalAppointmentsSection } from "@/components/requests/MedicalAppointmentsSection";
import { SickDaysSection } from "@/components/requests/SickDaysSection";
import type { RequestType, RequestStatus, Role, Transportation, RequestActionType } from "@/types";

// ---------------------------------------------------------------------------
// SQL queries
// ---------------------------------------------------------------------------

const REQUEST_QUERY = `
  SELECT
    r.*,
    s.given_name AS soldier_given_name,
    s.family_name AS soldier_family_name,
    s.id_number AS soldier_id_number,
    s.civilian_id AS soldier_civilian_id,
    sq.name AS squad_name,
    p.name AS platoon_name
  FROM requests r
  JOIN soldiers s ON s.id = r.soldier_id
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  WHERE r.id = ?
`;

const ACTIONS_QUERY = `
  SELECT id, user_id, action, note, user_name, created_at
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
  medical_appointments: string | null;
  sick_days: string | null;
  special_conditions: number | null;
  created_at: string;
  updated_at: string;
  soldier_given_name: string;
  soldier_family_name: string;
  soldier_id_number: string | null;
  soldier_civilian_id: string | null;
  squad_name: string;
  platoon_name: string;
}

interface RawAction {
  id: string;
  user_id: string;
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
  note: "הערה",
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
    case "note":
      return <MessageSquare className={`${iconClass} text-blue-400`} />;
    default:
      return <Plus className={`${iconClass} text-muted-foreground`} />;
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function RequestDetailPage() {
  const router = useRouter();
  const goBack = useGoBack("/requests");
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

  const requestParams = useMemo(() => [requestId], [requestId]);
  const { data: requestRows, isLoading: requestLoading } = useQuery<RawRequest>(REQUEST_QUERY, requestParams);
  const raw = requestRows?.[0] ?? null;

  const { data: actionRows } = useQuery<RawAction>(ACTIONS_QUERY, requestParams);

  const { selectedAssignment } = useCycle();
  const rawUserRole = (selectedAssignment?.role ?? "") as Role | "";

  const [acting, setActing] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogAction, setNoteDialogAction] = useState<"approve" | "deny">("approve");
  const [actionNote, setActionNote] = useState("");

  // Add-note dialog
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [addNoteText, setAddNoteText] = useState("");

  // Inline note editing
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  // Edit / delete dialogs
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { showLoading, showEmpty, showConnectionError } = useSyncReady(!!raw, requestLoading);

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "request-detail", steps: requestDetailTourSteps });
  useEffect(() => { registerTour(startTour); return unregisterTour; }, [registerTour, unregisterTour, startTour]);

  if (!raw && showConnectionError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
        <p className="font-medium">לא ניתן לטעון נתונים</p>
        <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
      </div>
    );
  }

  if (!raw && showEmpty) {
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

  // Role-based edit/delete permissions
  const canEdit = rawUserRole ? canEditRequest(rawUserRole as Role, requestType) : false;
  const canDelete = rawUserRole ? canDeleteRequest(rawUserRole as Role, requestType, assignedRole) : false;

  // Inline editing permissions for appointments/sick days sections
  // These stay workflow-aware: assigned role, medics, coordinators, platoon commanders
  const effRole = rawUserRole ? effectiveRole(rawUserRole as Role) : "";
  const isMedicOnMedical = rawUserRole === "company_medic" && requestType === "medical";
  const isCoordinatorOnHardship = rawUserRole === "hardship_coordinator" && requestType === "hardship";
  const isPlatoonCmdrOnMedical = effRole === "platoon_commander" && requestType === "medical";
  const canEditSections = isAssignedToMe || isMedicOnMedical || isCoordinatorOnHardship || isPlatoonCmdrOnMedical || canEdit;

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

  async function handleAddNote() {
    const text = addNoteText.trim();
    if (!text) return;
    setActing(true);
    try {
      await insertAction("note", text);
      toast.success("הערה נוספה");
      setAddNoteOpen(false);
      setAddNoteText("");
    } catch {
      toast.error("שגיאה בהוספת הערה");
    } finally {
      setActing(false);
    }
  }

  async function handleEditNote(actionId: string) {
    setActing(true);
    try {
      await db.execute(
        `UPDATE request_actions SET note = ? WHERE id = ?`,
        [editingNoteText.trim() || null, actionId],
      );
      toast.success("הערה עודכנה");
      setEditingActionId(null);
    } catch {
      toast.error("שגיאה בעדכון הערה");
    } finally {
      setActing(false);
    }
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

  async function handleDelete() {
    setDeleting(true);
    try {
      await db.execute("DELETE FROM request_actions WHERE request_id = ?", [raw.id]);
      await db.execute("DELETE FROM requests WHERE id = ?", [raw.id]);
      toast.success("הבקשה נמחקה");
      router.push("/requests");
    } catch {
      toast.error("שגיאה במחיקת הבקשה");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={goBack}
        className="flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground hover:bg-muted rounded-md px-1.5 py-0.5 -ms-1.5 transition-colors"
      >
        <ArrowRight size={18} />
        <span>חזרה לבקשות</span>
      </button>

      {/* Header card */}
      <div data-tour="request-header" className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <RequestTypeIcon type={requestType} size={20} urgent={isRequestOpen({ status: raw.status, type: raw.type, departureAt: raw.departure_at, returnAt: raw.return_at, medicalAppointments: raw.medical_appointments }) && isRequestUrgent({ type: raw.type, urgent: raw.urgent, specialConditions: raw.special_conditions })} />
            </span>
            <div>
              <h1 className="text-lg font-bold">{REQUEST_TYPE_LABELS[requestType]}</h1>
              <p className="text-sm text-muted-foreground">
                {raw.soldier_family_name} {raw.soldier_given_name} · {raw.platoon_name} / {raw.squad_name}
              </p>
              {(raw.soldier_id_number || raw.soldier_civilian_id) && (
                <p className="text-xs text-muted-foreground">
                  {raw.soldier_id_number && `מ.א. ${raw.soldier_id_number}`}
                  {raw.soldier_id_number && raw.soldier_civilian_id && " · "}
                  {raw.soldier_civilian_id && `מ.ז. ${raw.soldier_civilian_id}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={REQUEST_STATUS_VARIANT[requestStatus]}>
              {REQUEST_STATUS_LABELS[requestStatus]}
            </Badge>
            {raw.urgent ? (
              <Badge variant="destructive">דחוף</Badge>
            ) : null}
            {canDelete && (
              <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setConfirmDeleteOpen(true)} aria-label="מחק בקשה">
                <Trash2 size={14} />
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setEditDialogOpen(true)} aria-label="ערוך בקשה">
                <Pencil size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* Assignment indicator */}
        {assignedRole && (
          <div
            data-tour="request-assignment"
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
          <div data-tour="request-assignment" className="rounded-lg px-3 py-2 text-sm bg-emerald-50 text-emerald-800 border border-emerald-200">
            הטיפול בבקשה הושלם
          </div>
        )}
      </div>

      {/* Details card */}
      <div data-tour="request-details" className="rounded-xl border border-border bg-card p-4 space-y-1">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">פרטי הבקשה</h2>

        {raw.description ? (
          <div className="py-2 border-b border-border">
            <span className="text-sm text-muted-foreground">תיאור</span>
            <p className="text-sm font-medium mt-1 whitespace-pre-wrap">{raw.description}</p>
          </div>
        ) : null}
        <DetailRow label="מחלקה" value={raw.platoon_name} />

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
            <MedicalAppointmentsSection
              requestId={raw.id}
              medicalAppointmentsJson={raw.medical_appointments}
              canEdit={canEditSections}
            />
            <SickDaysSection
              requestId={raw.id}
              sickDaysJson={raw.sick_days}
              canEdit={canEditSections}
            />
          </>
        )}

        {/* Hardship-specific */}
        {requestType === "hardship" && (
          <DetailRow
            label="אוכלוסיות מיוחדות"
            value={raw.special_conditions ? "כן" : "לא"}
          />
        )}
      </div>

      {/* Audit trail */}
      {actionRows && actionRows.length > 0 && (
        <div data-tour="request-timeline" className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">מהלך הטיפול</h2>
          <div className="space-y-0">
            {actionRows.map((a, i) => {
              const isOwn = a.user_id === session?.user?.id;
              const canEditNote = isOwn && assignedRole !== null;
              const isEditing = editingActionId === a.id;

              return (
                <div key={a.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <ActionIcon action={a.action} />
                    </div>
                    {i < actionRows.length - 1 && (
                      <div className="flex-1 w-px bg-border my-1" />
                    )}
                  </div>
                  <div className="pb-3 min-w-0 flex-1">
                    <div className="md:flex md:items-start md:gap-3">
                    <div className="shrink-0">
                    <p className="text-sm font-medium">
                      {ACTION_LABELS[a.action as RequestActionType] ?? a.action}
                      {" · "}
                      <span className="text-muted-foreground font-normal">{a.user_name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </p>
                    </div>
                    {!isEditing && a.note && (
                      <div className="hidden md:flex items-start gap-1 min-w-0 flex-1">
                        <p className="flex-1 min-w-0 text-sm whitespace-pre-wrap text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                          {a.note}
                        </p>
                        {canEditNote && (
                          <button
                            type="button"
                            onClick={() => { setEditingActionId(a.id); setEditingNoteText(a.note ?? ""); }}
                            className="shrink-0 mt-1.5 text-muted-foreground hover:text-foreground"
                            title="ערוך הערה"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    </div>
                    {isEditing ? (
                      <div className="mt-1 space-y-1.5">
                        <textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          rows={2}
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditNote(a.id)}
                            disabled={acting}
                            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            <Check size={12} />
                            שמור
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingActionId(null)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                          >
                            <X size={12} />
                            ביטול
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {a.note && (
                          <div className="md:hidden flex items-start gap-1 mt-1">
                            <p className="flex-1 text-sm whitespace-pre-wrap text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                              {a.note}
                            </p>
                            {canEditNote && (
                              <button
                                type="button"
                                onClick={() => { setEditingActionId(a.id); setEditingNoteText(a.note ?? ""); }}
                                className="shrink-0 mt-1.5 text-muted-foreground hover:text-foreground"
                                title="ערוך הערה"
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                        )}
                        {!a.note && canEditNote && (
                          <button
                            type="button"
                            onClick={() => { setEditingActionId(a.id); setEditingNoteText(""); }}
                            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Pencil size={10} />
                            הוסף הערה
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {rawUserRole && (
            <button
              data-tour="request-add-note"
              type="button"
              onClick={() => { setAddNoteText(""); setAddNoteOpen(true); }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <MessageSquare size={16} />
              הוסף הערה
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {actions.length > 0 && (
        <div data-tour="request-actions" className="flex gap-2">
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

      {/* Add note dialog */}
      <Dialog open={addNoteOpen} onOpenChange={setAddNoteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>הוספת הערה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <textarea
              value={addNoteText}
              onChange={(e) => setAddNoteText(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="כתוב הערה..."
              rows={3}
            />
          </div>
          <div className="flex flex-row-reverse gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddNoteOpen(false)} className="flex-1">
              ביטול
            </Button>
            <Button
              onClick={handleAddNote}
              disabled={acting || !addNoteText.trim()}
              className="flex-1"
            >
              <MessageSquare size={16} className="ml-2" />
              הוסף
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
          <div className="flex flex-row-reverse gap-2 pt-2">
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

      {/* Edit request dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת {REQUEST_TYPE_LABELS[requestType]}</DialogTitle>
          </DialogHeader>
          {requestType === "leave" && (
            <EditLeaveRequestForm
              request={{
                id: raw.id,
                description: raw.description,
                place: raw.place,
                departureAt: raw.departure_at,
                returnAt: raw.return_at,
                transportation: raw.transportation,
              }}
              onSuccess={() => { setEditDialogOpen(false); toast.success("הבקשה עודכנה"); }}
              onCancel={() => setEditDialogOpen(false)}
            />
          )}
          {requestType === "medical" && (
            <EditMedicalRequestForm
              request={{
                id: raw.id,
                description: raw.description,
                paramedicDate: raw.paramedic_date,
                urgent: raw.urgent,
              }}
              onSuccess={() => { setEditDialogOpen(false); toast.success("הבקשה עודכנה"); }}
              onCancel={() => setEditDialogOpen(false)}
            />
          )}
          {requestType === "hardship" && (
            <EditHardshipRequestForm
              request={{
                id: raw.id,
                description: raw.description,
                urgent: raw.urgent,
                specialConditions: raw.special_conditions,
              }}
              onSuccess={() => { setEditDialogOpen(false); toast.success("הבקשה עודכנה"); }}
              onCancel={() => setEditDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת בקשה</DialogTitle>
            <DialogDescription>
              האם למחוק את הבקשה? פעולה זו לא ניתנת לביטול.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={deleting}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "מוחק..." : "מחק"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
