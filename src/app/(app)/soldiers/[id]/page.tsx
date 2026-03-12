"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Pencil, CheckCircle } from "lucide-react";
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

interface ActivityReport {
  id: string;
  result: string;
  grade: number | null;
  note: string | null;
  activity: {
    id: string;
    name: string;
    date: string;
    status: string;
    isRequired: boolean;
    activityType: { name: string };
  };
}

interface MissingActivity {
  id: string;
  name: string;
  date: string;
  activityType: { name: string };
}

interface SoldierDetail {
  id: string;
  givenName: string;
  familyName: string;
  rank: string | null;
  status: SoldierStatus;
  profileImage: string | null;
  cycleId: string;
  squadId: string;
  squad: {
    id: string;
    name: string;
    platoonId: string;
    platoon: { id: string; name: string };
  };
  activityReports: ActivityReport[];
  missingActivities: MissingActivity[];
}

export default function SoldierDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const soldierId = params.id;

  const [soldier, setSoldier] = useState<SoldierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!soldierId) return;
    setLoading(true);
    fetch(`/api/soldiers/${soldierId}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d: SoldierDetail) => setSoldier(d))
      .catch(() => setSoldier(null))
      .finally(() => setLoading(false));
  }, [soldierId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        טוען...
      </div>
    );
  }

  if (!soldier) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <p className="font-medium">חייל לא נמצא</p>
        <Button variant="outline" onClick={() => router.push("/soldiers")}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }

  const initials =
    (soldier.givenName[0] ?? "") + (soldier.familyName[0] ?? "");
  const colorClass = getAvatarColor(soldier.givenName + soldier.familyName);
  const statusVariant = STATUS_VARIANT[soldier.status];

  const failedReports = soldier.activityReports.filter(
    (r) => r.activity.status === "active" && r.activity.isRequired && r.result === "failed"
  );

  const gapCount = failedReports.length + soldier.missingActivities.length;

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
  }

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
            {soldier.profileImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={soldier.profileImage}
                alt={`${soldier.givenName} ${soldier.familyName}`}
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
                  {soldier.familyName} {soldier.givenName}
                </h1>
                {soldier.rank && (
                  <p className="text-sm text-muted-foreground">{soldier.rank}</p>
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
                soldier.status === "injured"
                  ? "bg-amber-100 text-amber-800 border-amber-200 w-fit"
                  : "w-fit"
              }
            >
              {STATUS_LABEL[soldier.status]}
            </Badge>

            <p className="text-sm text-muted-foreground">
              {soldier.squad.platoon.name} / {soldier.squad.name}
            </p>
          </div>
        </div>
      </div>

      {/* Gap activities section */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          פעילויות עם חסרים
        </h2>

        {gapCount === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-emerald-600">
            <CheckCircle size={16} />
            <span>אין חסרים</span>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-card divide-y divide-border overflow-hidden">
            {failedReports.map((r) => (
              <Link
                key={r.id}
                href={`/activities/${r.activity.id}?gaps=1`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{r.activity.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.activity.activityType.name} · {formatDate(r.activity.date)}
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
            {soldier.missingActivities.map((a) => (
              <Link
                key={a.id}
                href={`/activities/${a.id}?gaps=1`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.activityType.name} · {formatDate(a.date)}
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
            onSuccess={(updated) => {
              setSoldier((prev) =>
                prev
                  ? {
                      ...prev,
                      givenName: updated.givenName,
                      familyName: updated.familyName,
                      rank: updated.rank,
                      status: updated.status,
                      profileImage: updated.profileImage,
                    }
                  : prev
              );
              setEditOpen(false);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
