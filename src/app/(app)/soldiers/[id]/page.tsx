"use client";

import { useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Pencil, CheckCircle } from "lucide-react";
import { useQuery } from "@powersync/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditSoldierForm } from "@/components/soldiers/EditSoldierForm";
import type { SoldierStatus } from "@/types";

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
    s.cycle_id, s.squad_id,
    sq.name AS squad_name, sq.platoon_id,
    p.id AS platoon_id, p.name AS platoon_name
  FROM soldiers s
  JOIN squads sq ON sq.id = s.squad_id
  JOIN platoons p ON p.id = sq.platoon_id
  WHERE s.id = ?
`;

const REPORTS_QUERY = `
  SELECT
    ar.id, ar.result, ar.grade, ar.note,
    a.id   AS activity_id,
    a.name AS activity_name,
    a.date AS activity_date,
    a.status AS activity_status,
    a.is_required,
    at.name AS activity_type_name
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
  AND NOT EXISTS (
    SELECT 1 FROM activity_reports ar
    WHERE ar.activity_id = a.id AND ar.soldier_id = ?
  )
  ORDER BY a.date DESC
`;

interface RawSoldier {
  id: string; given_name: string; family_name: string;
  rank: string | null; status: string; profile_image: string | null;
  cycle_id: string; squad_id: string;
  squad_name: string; platoon_id: string; platoon_name: string;
}
interface RawReport {
  id: string; result: string; grade: number | null; note: string | null;
  activity_id: string; activity_name: string; activity_date: string;
  activity_status: string; is_required: number;
  activity_type_name: string;
}
interface RawMissing {
  id: string; name: string; date: string; activity_type_name: string;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SoldierDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const soldierId = params.id;

  const [editOpen, setEditOpen] = useState(false);

  const soldierParams = useMemo(() => [soldierId], [soldierId]);
  const missingParams = useMemo(() => [soldierId, soldierId], [soldierId]);

  const { data: soldierRows, loading: soldierLoading } = useQuery<RawSoldier>(SOLDIER_QUERY, soldierParams);
  const { data: reportRows } = useQuery<RawReport>(REPORTS_QUERY, soldierParams);
  const { data: missingRows } = useQuery<RawMissing>(MISSING_QUERY, missingParams);

  const raw = soldierRows?.[0] ?? null;

  if (soldierLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        טוען...
      </div>
    );
  }

  if (!raw) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <p className="font-medium">חייל לא נמצא</p>
        <Button variant="outline" onClick={() => router.push("/soldiers")}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }

  const soldier = {
    id: raw.id,
    givenName: raw.given_name,
    familyName: raw.family_name,
    rank: raw.rank,
    status: raw.status as SoldierStatus,
    profileImage: raw.profile_image,
  };

  const failedReports = (reportRows ?? []).filter(
    (r) => r.activity_status === "active" && Number(r.is_required) === 1 && r.result === "failed"
  );
  const gapCount = failedReports.length + (missingRows ?? []).length;

  const initials = (raw.given_name[0] ?? "") + (raw.family_name[0] ?? "");
  const colorClass = getAvatarColor(raw.given_name + raw.family_name);
  const statusVariant = STATUS_VARIANT[raw.status as SoldierStatus];

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.push("/soldiers")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowRight size={16} />
        <span>חזרה</span>
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-white font-bold text-2xl ${colorClass}`}
          >
            {raw.profile_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={raw.profile_image}
                alt={`${raw.given_name} ${raw.family_name}`}
                className="h-20 w-20 rounded-full object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>

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
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setEditOpen(true)}
                aria-label="ערוך פרטי חייל"
              >
                <Pencil size={14} />
              </Button>
            </div>

            <Badge
              variant={statusVariant}
              className={
                raw.status === "injured"
                  ? "bg-amber-100 text-amber-800 border-amber-200 w-fit"
                  : "w-fit"
              }
            >
              {STATUS_LABEL[raw.status as SoldierStatus]}
            </Badge>

            <p className="text-sm text-muted-foreground">
              {raw.platoon_name} / {raw.squad_name}
            </p>
          </div>
        </div>
      </div>

      {/* Gap activities section */}
      <div className="space-y-2">
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
                  {r.grade !== null && (
                    <p className="text-xs text-muted-foreground">ציון: {r.grade}</p>
                  )}
                  {r.note && (
                    <p className="text-xs text-muted-foreground truncate">הערה: {r.note}</p>
                  )}
                </div>
                <Badge variant="destructive" className="shrink-0 mt-0.5 text-xs">נכשל</Badge>
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

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת פרטי חייל</DialogTitle>
          </DialogHeader>
          <EditSoldierForm
            soldier={soldier}
            onSuccess={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
