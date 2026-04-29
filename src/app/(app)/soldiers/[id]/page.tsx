"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Pencil, CheckCircle, Plus, FileText, Trash2, MessageCircle, Navigation, WifiOff, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";
import { useSyncReady } from "@/hooks/useSyncReady";
import { useGoBack } from "@/hooks/useGoBack";
import { useTour } from "@/hooks/useTour";
import { useTourContext } from "@/contexts/TourContext";
import { soldierDetailTourSteps } from "@/lib/tour/steps";
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
import { EditSoldierForm } from "@/components/soldiers/EditSoldierForm";
import { CreateRequestForm } from "@/components/requests/CreateRequestForm";
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_VARIANT,
  ASSIGNED_ROLE_LABELS,
} from "@/lib/requests/constants";
import { RequestTypeIcon } from "@/components/requests/RequestTypeIcon";
import { isRequestActive, isRequestOpen, isRequestUrgent } from "@/lib/requests/active";
import type { SoldierStatus, RequestType, RequestStatus, Role } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";
import { toIsraeliDisplay } from "@/lib/phone";
import { parseScoreConfig, getActiveScores } from "@/types/score-config";
import { parseDisplayConfig, getResultLabels } from "@/types/display-config";
import { formatGradeDisplay } from "@/lib/score-format";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<SoldierStatus, string> = {
  active: "פעיל",
  transferred: "הועבר",
  dropped: "נשר",
  injured: "פצוע",
};

const STATUS_VARIANT: Record<
  SoldierStatus,
  "default" | "outline" | "destructive" | "secondary"
> = {
  active: "default",
  transferred: "outline",
  dropped: "destructive",
  injured: "secondary",
};

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const SOLDIER_QUERY = `
  SELECT
    s.id, s.given_name, s.family_name, s.rank, s.status, s.profile_image,
    s.id_number, s.civilian_id, s.cycle_id, s.squad_id, s.phone, s.emergency_phone,
    s.street, s.apt, s.city, s.notes, s.date_of_birth,
    sq.name AS squad_name, sq.platoon_id,
    p.id AS platoon_id, p.name AS platoon_name
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  WHERE s.id = ?
`;

const REPORTS_QUERY = `
  SELECT
    ar.id, ar.result, ar.failed, ar.grade1, ar.grade2, ar.grade3, ar.grade4, ar.grade5, ar.grade6, ar.note,
    a.id   AS activity_id,
    a.name AS activity_name,
    a.date AS activity_date,
    a.status AS activity_status,
    a.is_required,
    at.name AS activity_type_name,
    at.score_config,
    at.display_configuration
  FROM activity_reports ar
  JOIN activities a    ON a.id  = ar.activity_id
  JOIN activity_types at ON at.id = a.activity_type_id
  WHERE ar.soldier_id = ?
  ORDER BY a.date DESC
`;

// Activities in the soldier's platoon that are required+active with no report for this soldier.
// Params: [soldierId, soldierId]
const MISSING_QUERY = `
  SELECT a.id, a.name, a.date, at.name AS activity_type_name
  FROM activities a
  JOIN activity_types at ON at.id = a.activity_type_id
  WHERE a.platoon_id = (
    SELECT sq.platoon_id FROM squads sq
    JOIN soldiers s ON s.squad_id = sq.id
    WHERE s.id = ?
  )
  AND a.status = 'active'
  AND a.is_required = 1
  AND a.date < DATE('now')
  AND NOT EXISTS (
    SELECT 1 FROM activity_reports ar
    WHERE ar.activity_id = a.id AND ar.soldier_id = ?
  )
  ORDER BY a.date DESC
`;

// All requests for this soldier (full history)
const SOLDIER_REQUESTS_QUERY = `
  SELECT r.id, r.type, r.status, r.assigned_role, r.description, r.urgent, r.special_conditions, r.created_at,
    r.departure_at, r.return_at, r.medical_appointments
  FROM requests r
  WHERE r.soldier_id = ?
  ORDER BY r.created_at DESC
`;

// Check if soldier has an active hardship request with special_conditions
const SPECIAL_CONDITIONS_QUERY = `
  SELECT COUNT(*) as count
  FROM requests
  WHERE soldier_id = ?
    AND type = 'hardship'
    AND special_conditions = 1
    AND (status = 'open' OR status = 'approved')
`;

interface RawSoldierRequest {
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
}

interface RawSoldier {
  id: string; given_name: string; family_name: string;
  id_number: string | null; civilian_id: string | null; rank: string | null; status: string; profile_image: string | null;
  phone: string | null; emergency_phone: string | null;
  street: string | null; apt: string | null; city: string | null; notes: string | null;
  date_of_birth: string | null;
  cycle_id: string; squad_id: string;
  squad_name: string; platoon_id: string; platoon_name: string;
}
interface RawReport {
  id: string; result: string; failed: number;
  grade1: number | null; grade2: number | null; grade3: number | null;
  grade4: number | null; grade5: number | null; grade6: number | null;
  note: string | null;
  activity_id: string; activity_name: string; activity_date: string;
  activity_status: string; is_required: number;
  activity_type_name: string;
  score_config: string | null;
  display_configuration: string | null;
}
interface RawMissing {
  id: string; name: string; date: string; activity_type_name: string;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SoldierDetailPage() {
  const router = useRouter();
  const goBack = useGoBack("/soldiers");
  const params = useParams<{ id: string }>();

  // The SW caches one HTML shell for all /soldiers/[id] pages (app shell pattern).
  // Next.js bakes useParams() into the hydration data, so when the SW serves a
  // shell cached from /soldiers/_ for /soldiers/<real-uuid>, useParams() returns
  // "_" instead of the real UUID. Read the actual URL after hydration to fix this.
  const [soldierId, setSoldierId] = useState(params.id);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/soldiers\/([^/]+)$/);
    if (match && match[1] !== soldierId) {
      setSoldierId(match[1]);
    }
  }, []);

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [requestTypeMenuOpen, setRequestTypeMenuOpen] = useState(false);
  const [createRequestType, setCreateRequestType] = useState<RequestType | null>(null);
  const [imageZoomOpen, setImageZoomOpen] = useState(false);
  const { selectedCycleId, selectedAssignment } = useCycle();
  const rawUserRole = (selectedAssignment?.role ?? "") as Role | "";
  const userRole = rawUserRole ? effectiveRole(rawUserRole) : "";
  const canDelete = userRole === "platoon_commander" || userRole === "company_commander";

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/soldiers/${soldierId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.error ?? "שגיאה במחיקה");
        return;
      }
      toast.success("החייל נמחק");
      router.push("/soldiers");
    } catch {
      setDeleteError("שגיאה במחיקה");
    } finally {
      setDeleting(false);
    }
  }

  const soldierParams = useMemo(() => [soldierId], [soldierId]);
  const missingParams = useMemo(() => [soldierId, soldierId], [soldierId]);

  const { data: soldierRows, isLoading: soldierLoading } = useQuery<RawSoldier>(SOLDIER_QUERY, soldierParams);
  const { data: reportRows } = useQuery<RawReport>(REPORTS_QUERY, soldierParams);
  const { data: missingRows } = useQuery<RawMissing>(MISSING_QUERY, missingParams);
  const { data: soldierRequests } = useQuery<RawSoldierRequest>(SOLDIER_REQUESTS_QUERY, soldierParams);
  const { data: specialConditionsRows } = useQuery<{ count: number }>(SPECIAL_CONDITIONS_QUERY, soldierParams);
  const hasSpecialConditions = Number(specialConditionsRows?.[0]?.count ?? 0) > 0;

  const raw = soldierRows?.[0] ?? null;
  const { showLoading, showEmpty, showConnectionError } = useSyncReady(!!raw, soldierLoading);

  // Tour
  const { registerTour, unregisterTour } = useTourContext();
  const { startTour } = useTour({ page: "soldier-detail", steps: soldierDetailTourSteps });
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
        <p className="font-medium">חייל לא נמצא</p>
        <Button variant="outline" onClick={() => router.push("/soldiers")}>
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

  const soldier = {
    id: raw.id,
    givenName: raw.given_name,
    familyName: raw.family_name,
    idNumber: raw.id_number,
    civilianId: raw.civilian_id,
    rank: raw.rank,
    status: raw.status as SoldierStatus,
    profileImage: raw.profile_image,
    phone: raw.phone,
    emergencyPhone: raw.emergency_phone,
    street: raw.street,
    apt: raw.apt,
    city: raw.city,
    notes: raw.notes,
    dateOfBirth: raw.date_of_birth,
  };

  const todayStr = new Date().toISOString().split("T")[0];
  const failedReports = (reportRows ?? []).filter(
    (r) => r.activity_status === "active" && Number(r.is_required) === 1 && (r.result === "skipped" || Number(r.failed) === 1) && r.activity_date.split("T")[0] < todayStr
  );
  const gapCount = failedReports.length + (missingRows ?? []).length;

  // Completed activities: reports that are not gaps (passed, na, or non-required/non-active)
  const failedIds = new Set(failedReports.map((r) => r.id));
  const completedReports = (reportRows ?? []).filter((r) => !failedIds.has(r.id));

  const initials = (raw.given_name[0] ?? "") + (raw.family_name[0] ?? "");
  const colorClass = getAvatarColor(raw.given_name + raw.family_name);
  const statusVariant = STATUS_VARIANT[raw.status as SoldierStatus];

  // Birthday check
  const isBirthday = (() => {
    if (!raw.date_of_birth) return false;
    const dob = new Date(raw.date_of_birth);
    const now = new Date();
    return dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate();
  })();
  const birthdayAge = (() => {
    if (!raw.date_of_birth || !isBirthday) return 0;
    const dob = new Date(raw.date_of_birth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;
    return age;
  })();

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={goBack}
        className="flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground hover:bg-muted rounded-md px-1.5 py-0.5 -ms-1.5 transition-colors"
      >
        <ArrowRight size={18} />
        <span>חזרה לחיילים</span>
      </button>

      {/* Header card */}
      <div data-tour="soldier-header" className={`rounded-xl border bg-card p-4 space-y-4 ${isBirthday ? "border-pink-300 dark:border-pink-700" : "border-border"}`}>
        {isBirthday && (
          <div className="flex items-center gap-2 rounded-lg bg-pink-50 dark:bg-pink-950/30 px-3 py-2 text-sm font-semibold text-pink-700 dark:text-pink-300">
            <span>🎂</span>
            <span>היום יום ההולדת ה-{birthdayAge} ל{raw.given_name}!</span>
            <span>🎉</span>
          </div>
        )}
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <button
            type="button"
            data-tour="soldier-avatar"
            disabled={!raw.profile_image}
            onClick={() => raw.profile_image && setImageZoomOpen(true)}
            className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-white font-bold text-2xl ${colorClass} ${raw.profile_image ? "cursor-zoom-in group" : ""}`}
          >
            {raw.profile_image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={raw.profile_image}
                  alt={`${raw.given_name} ${raw.family_name}`}
                  className="h-20 w-20 rounded-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 group-hover:bg-black/30 transition-colors">
                  <ZoomIn size={20} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                </span>
              </>
            ) : (
              <span>{initials}</span>
            )}
          </button>

          {/* Info */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-lg font-bold leading-tight">
                  {raw.family_name} {raw.given_name}
                </h1>
                {raw.rank && (
                  <p className="text-sm text-muted-foreground">{raw.rank}</p>
                )}
                {raw.id_number && (
                  <p className="text-sm text-muted-foreground">מ.א. {raw.id_number}</p>
                )}
                {raw.civilian_id && (
                  <p className="text-sm text-muted-foreground">מ.ז. {raw.civilian_id}</p>
                )}
                {raw.date_of_birth && (
                  <p className="text-sm text-muted-foreground">
                    ת.לידה {new Date(raw.date_of_birth).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {canDelete && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="מחק חייל"
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
                <Button
                  data-tour="soldier-edit-btn"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setEditOpen(true)}
                  aria-label="ערוך פרטי חייל"
                >
                  <Pencil size={14} />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge
                variant={statusVariant}
                className={
                  raw.status === "injured"
                    ? "bg-amber-100 text-amber-800 border-amber-200"
                    : ""
                }
              >
                {STATUS_LABEL[raw.status as SoldierStatus]}
              </Badge>
              {hasSpecialConditions && (
                <Badge className="bg-purple-100 text-purple-800 border-purple-200">
                  ת&quot;ש מיוחד
                </Badge>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              {raw.platoon_name} / {raw.squad_name}
            </p>
          </div>
        </div>

        {/* Contact info & notes */}
        {(raw.phone || raw.emergency_phone || raw.street || raw.city || raw.notes) && (
          <div className="border-t border-border pt-3 space-y-1.5 text-sm">
            {raw.phone && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">טלפון:</span>
                <a href={`tel:${raw.phone}`} className="text-primary hover:underline" dir="ltr">{toIsraeliDisplay(raw.phone)}</a>
                <a
                  href={`https://wa.me/${raw.phone.replace("+", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:text-emerald-700 transition-colors"
                  aria-label="שלח הודעת WhatsApp"
                >
                  <MessageCircle size={16} />
                </a>
              </div>
            )}
            {raw.emergency_phone && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">טלפון חירום:</span>
                <a href={`tel:${raw.emergency_phone}`} className="text-primary hover:underline" dir="ltr">{toIsraeliDisplay(raw.emergency_phone)}</a>
              </div>
            )}
            {(raw.street || raw.city) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">כתובת:</span>
                <span>{[raw.street, raw.apt ? `דירה ${raw.apt}` : null, raw.city].filter(Boolean).join(", ")}</span>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent([raw.street, raw.city].filter(Boolean).join(", "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600 transition-colors"
                  aria-label="נווט לכתובת"
                >
                  <Navigation size={16} />
                </a>
              </div>
            )}
            {raw.notes && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0">הערות:</span>
                <span className="whitespace-pre-wrap">{raw.notes}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Requests section */}
      <div data-tour="soldier-requests" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">בקשות</h2>
          {(userRole === "squad_commander" || userRole === "platoon_commander") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRequestTypeMenuOpen(true)}
            >
              <Plus size={14} className="ml-1" />
              בקשה חדשה
            </Button>
          )}
        </div>

        {(!soldierRequests || soldierRequests.length === 0) ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <FileText size={16} />
            <span>אין בקשות</span>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {soldierRequests.map((r) => {
              const isActive = isRequestActive({
                status: r.status,
                type: r.type,
                departureAt: r.departure_at,
                returnAt: r.return_at,
                medicalAppointments: r.medical_appointments,
              });
              return (
              <Link
                key={r.id}
                href={`/requests/${r.id}`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <RequestTypeIcon type={r.type as RequestType} size={16} urgent={isRequestOpen({ status: r.status, type: r.type, departureAt: r.departure_at, returnAt: r.return_at, medicalAppointments: r.medical_appointments }) && isRequestUrgent({ type: r.type, urgent: r.urgent, specialConditions: r.special_conditions })} />
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{REQUEST_TYPE_LABELS[r.type as RequestType]}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.description || "—"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant={REQUEST_STATUS_VARIANT[r.status as RequestStatus]} className="text-xs">
                    {REQUEST_STATUS_LABELS[r.status as RequestStatus]}
                  </Badge>
                  {isActive && (
                    <span className="text-[10px] font-medium text-emerald-600">פעילה</span>
                  )}
                  {r.assigned_role && (
                    <span className="text-[10px] text-muted-foreground">
                      {ASSIGNED_ROLE_LABELS[r.assigned_role as Role]}
                    </span>
                  )}
                </div>
              </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Gap activities section */}
      <div data-tour="soldier-gaps" className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          פעילויות עם פערים
        </h2>

        {gapCount === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-emerald-600">
            <CheckCircle size={16} />
            <span>אין פערים</span>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-card divide-y divide-border overflow-hidden">
            {failedReports.map((r) => (
              <Link
                key={r.id}
                href={`/activities/${r.activity_id}?gaps=1`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{r.activity_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.activity_type_name} · {formatDate(r.activity_date)}
                  </p>
                  {(() => {
                    const scores = getActiveScores(parseScoreConfig(r.score_config));
                    const grades = [r.grade1, r.grade2, r.grade3, r.grade4, r.grade5, r.grade6];
                    const withValues = scores
                      .map((s) => ({ label: s.label, format: s.format, grade: grades[parseInt(s.key.replace("score", "")) - 1] }))
                      .filter((a) => a.grade != null);
                    if (withValues.length === 0) return null;
                    return <p className="text-xs text-muted-foreground">{withValues.map((a) => `${a.label}: ${formatGradeDisplay(a.grade, a.format)}`).join(" · ")}</p>;
                  })()}
                  {r.note && (
                    <p className="text-xs text-muted-foreground truncate">הערה: {r.note}</p>
                  )}
                </div>
                <Badge variant="destructive" className="shrink-0 mt-0.5 text-xs">{Number(r.failed) ? "נכשל" : getResultLabels(parseDisplayConfig(r.display_configuration)).skipped.label}</Badge>
              </Link>
            ))}
            {(missingRows ?? []).map((a) => (
              <Link
                key={a.id}
                href={`/activities/${a.id}?gaps=1`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.activity_type_name} · {formatDate(a.date)}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 mt-0.5 text-xs text-amber-700 border-amber-300">חסר</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Completed activities section */}
      <div data-tour="soldier-completed" className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          פעילויות שהושלמו
        </h2>

        {completedReports.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <FileText size={16} />
            <span>אין פעילויות שהושלמו</span>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {completedReports.map((r) => {
              const scores = getActiveScores(parseScoreConfig(r.score_config));
              const grades = [r.grade1, r.grade2, r.grade3, r.grade4, r.grade5, r.grade6];
              const withValues = scores
                .map((s) => ({ label: s.label, format: s.format, grade: grades[parseInt(s.key.replace("score", "")) - 1] }))
                .filter((a) => a.grade != null);
              const rl = getResultLabels(parseDisplayConfig(r.display_configuration));
              const resultLabel = r.result === "completed" ? rl.completed.label : r.result === "skipped" ? rl.skipped.label : r.result === "na" ? rl.na.label : null;
              return (
                <Link
                  key={r.id}
                  href={`/activities/${r.activity_id}`}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{r.activity_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.activity_type_name} · {formatDate(r.activity_date)}
                    </p>
                    {withValues.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {withValues.map((a) => `${a.label}: ${formatGradeDisplay(a.grade, a.format)}`).join(" · ")}
                      </p>
                    )}
                    {r.note && (
                      <p className="text-xs text-muted-foreground truncate">הערה: {r.note}</p>
                    )}
                  </div>
                  {resultLabel && (
                    <Badge
                      variant={r.result === "completed" && !Number(r.failed) ? "default" : r.result === "na" ? "secondary" : "destructive"}
                      className={`shrink-0 mt-0.5 text-xs ${r.result === "completed" && !Number(r.failed) ? "bg-emerald-600" : ""}`}
                    >
                      {resultLabel}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Image zoom dialog */}
      {raw.profile_image && (
        <Dialog open={imageZoomOpen} onOpenChange={setImageZoomOpen}>
          <DialogContent className="max-w-sm p-0 overflow-hidden bg-transparent border-none shadow-none">
            <DialogHeader className="sr-only">
              <DialogTitle>{raw.family_name} {raw.given_name}</DialogTitle>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={raw.profile_image}
              alt={`${raw.family_name} ${raw.given_name}`}
              className="w-full h-auto rounded-xl"
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Request type selection dialog */}
      <Dialog open={requestTypeMenuOpen} onOpenChange={setRequestTypeMenuOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>בחר סוג בקשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {(["leave", "medical", "hardship"] as RequestType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setRequestTypeMenuOpen(false);
                  setCreateRequestType(type);
                }}
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
      <Dialog open={!!createRequestType} onOpenChange={(open) => { if (!open) setCreateRequestType(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {createRequestType && (
                <>
                  <RequestTypeIcon type={createRequestType} size={18} className="ml-2 inline" />
                  {REQUEST_TYPE_LABELS[createRequestType]}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {createRequestType && selectedCycleId && rawUserRole && selectedAssignment && (
            <CreateRequestForm
              cycleId={selectedCycleId}
              requestType={createRequestType}
              userRole={rawUserRole as Role}
              unitId={selectedAssignment.unitId}
              preselectedSoldierId={soldierId}
              onSuccess={() => {
                setCreateRequestType(null);
                toast.success("הבקשה נוצרה בהצלחה");
              }}
              onCancel={() => setCreateRequestType(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת פרטי חייל</DialogTitle>
          </DialogHeader>
          <EditSoldierForm
            soldier={soldier}
            onSuccess={() => { setEditOpen(false); toast.success("החייל עודכן בהצלחה"); }}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת חייל</DialogTitle>
            <DialogDescription>
              האם למחוק את &quot;{raw.family_name} {raw.given_name}&quot;? פעולה זו תמחק גם את כל הדיווחים והבקשות הקשורים ולא ניתן לבטלה.
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
    </div>
  );
}
