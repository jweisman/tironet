"use client";

import { useState } from "react";
import { Plus, Award, AlertTriangle, Pencil, Trash2 } from "lucide-react";
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
import { IncidentForm } from "./IncidentForm";
import { usePowerSync } from "@powersync/react";

export interface RawIncident {
  id: string;
  soldier_id: string;
  type: string;
  date: string;
  created_by_name: string;
  created_by_user_id: string;
  description: string;
  response: string | null;
}

interface Props {
  incidents: RawIncident[];
  soldierId: string;
  canCreate: boolean;
  canEditDelete: boolean;
  userName: string;
  userId: string;
}

export function IncidentSection({ incidents, soldierId, canCreate, canEditDelete, userName, userId }: Props) {
  const db = usePowerSync();
  const [createOpen, setCreateOpen] = useState(false);
  const [editIncident, setEditIncident] = useState<RawIncident | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RawIncident | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = [...incidents].sort((a, b) => b.date.localeCompare(a.date));

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await db.execute("DELETE FROM incidents WHERE id = ?", [confirmDelete.id]);
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div data-tour="soldier-incidents" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">ציונים</h2>
        {canCreate && (
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="ml-1" />
            הוסף ציון
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Award size={16} />
          <span>אין ציונים</span>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {sorted.map((inc) => (
            <div key={inc.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {inc.type === "commendation" ? (
                      <Award size={14} className="text-green-600" />
                    ) : (
                      <AlertTriangle size={14} className="text-amber-500" />
                    )}
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      inc.type === "commendation"
                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800"
                    }
                  >
                    {inc.type === "commendation" ? "ציון לשבח" : "ציון התנהגות"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(inc.date).toLocaleDateString("he-IL")}
                  </span>
                </div>
                {canEditDelete && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      onClick={() => setEditIncident(inc)}
                      aria-label="ערוך ציון"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      onClick={() => setConfirmDelete(inc)}
                      aria-label="מחק ציון"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-sm">{inc.description}</p>
              {inc.response && (
                <p className="text-sm text-muted-foreground">תגובה: {inc.response}</p>
              )}
              <p className="text-xs text-muted-foreground">נוצר ע״י {inc.created_by_name}</p>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ציון חדש</DialogTitle>
          </DialogHeader>
          <IncidentForm
            soldierId={soldierId}
            userName={userName}
            userId={userId}
            onSuccess={() => setCreateOpen(false)}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editIncident} onOpenChange={(open) => !open && setEditIncident(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת ציון</DialogTitle>
          </DialogHeader>
          {editIncident && (
            <IncidentForm
              soldierId={soldierId}
              userName={userName}
              userId={userId}
              existing={editIncident}
              onSuccess={() => setEditIncident(null)}
              onCancel={() => setEditIncident(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת ציון</DialogTitle>
            <DialogDescription>
              האם למחוק את הציון? פעולה זו לא ניתנת לביטול.
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
