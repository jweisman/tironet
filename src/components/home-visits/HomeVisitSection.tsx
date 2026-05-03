"use client";

import { useState } from "react";
import { Plus, Home, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HomeVisitForm } from "./HomeVisitForm";
import { usePowerSync } from "@powersync/react";

export interface RawHomeVisit {
  id: string;
  soldier_id: string;
  date: string;
  created_by_name: string;
  created_by_user_id: string;
  status: string;
  notes: string | null;
  created_at: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  in_order: "תקין",
  deficiencies: "ליקויים",
};

interface Props {
  visits: RawHomeVisit[];
  soldierId: string;
  canCreate: boolean;
  canEditDelete: boolean;
  userName: string;
  userId: string;
}

export function HomeVisitSection({ visits, soldierId, canCreate, canEditDelete, userName, userId }: Props) {
  const db = usePowerSync();
  const [createOpen, setCreateOpen] = useState(false);
  const [editVisit, setEditVisit] = useState<RawHomeVisit | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RawHomeVisit | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = [...visits].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await db.execute("DELETE FROM home_visits WHERE id = ?", [confirmDelete.id]);
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div data-tour="soldier-home-visits" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">ביקורי בית</h2>
        {canCreate && (
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="ml-1" />
            ביקור חדש
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Home size={16} />
          <span>אין ביקורי בית</span>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {sorted.map((v) => (
            <div key={v.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Home size={14} />
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      v.status === "in_order"
                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800"
                    }
                  >
                    {STATUS_LABELS[v.status] ?? v.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.date).toLocaleDateString("he-IL")}
                  </span>
                </div>
                {canEditDelete && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      onClick={() => setEditVisit(v)}
                      aria-label="ערוך ביקור"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      onClick={() => setConfirmDelete(v)}
                      aria-label="מחק ביקור"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              {v.notes && <p className="text-sm">{v.notes}</p>}
              <p className="text-xs text-muted-foreground">נוצר ע״י {v.created_by_name}</p>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ביקור בית חדש</DialogTitle>
          </DialogHeader>
          <HomeVisitForm
            soldierId={soldierId}
            userName={userName}
            userId={userId}
            onSuccess={() => setCreateOpen(false)}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editVisit} onOpenChange={(open) => !open && setEditVisit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת ביקור בית</DialogTitle>
          </DialogHeader>
          {editVisit && (
            <HomeVisitForm
              soldierId={soldierId}
              userName={userName}
              userId={userId}
              existing={editVisit}
              onSuccess={() => setEditVisit(null)}
              onCancel={() => setEditVisit(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת ביקור בית</DialogTitle>
            <DialogDescription>
              האם למחוק את הביקור? פעולה זו לא ניתנת לביטול.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>
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
