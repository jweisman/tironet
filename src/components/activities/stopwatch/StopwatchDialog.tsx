"use client";

import { useState } from "react";
import { Flag, Pause, Play, QrCode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { useStopwatch } from "@/hooks/useStopwatch";
import { elapsedMs, formatStopwatch, roundToSeconds } from "@/lib/stopwatch/state";
import type { GradeKey } from "../ActivityDetail";
import { LapRow, type LapSoldier } from "./LapRow";
import { ShareDialog } from "./ShareDialog";

interface StopwatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string;
  activityName: string;
  scoreKey: string;
  gradeKey: GradeKey;
  scoreLabel: string;
  soldiers: LapSoldier[];
  onApply: (soldierId: string, gradeKey: GradeKey, seconds: number) => Promise<void>;
}

export function StopwatchDialog({
  open,
  onOpenChange,
  activityId,
  activityName,
  scoreKey,
  gradeKey,
  scoreLabel,
  soldiers,
  onApply,
}: StopwatchDialogProps) {
  const { state, now, start, pause, lap, reset, removeLap, importLaps } = useStopwatch({
    activityId,
    scoreKey,
    active: open,
  });
  const [expandedLapId, setExpandedLapId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteLapId, setConfirmDeleteLapId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const totalMs = elapsedMs(state, now);
  const isRunning = state.running;
  const hasLaps = state.laps.length > 0;
  const hasState = hasLaps || totalMs > 0;

  const lapToDelete = confirmDeleteLapId
    ? state.laps.find((l) => l.id === confirmDeleteLapId)
    : null;

  async function handleApply(lapId: string, soldierId: string) {
    const target = state.laps.find((l) => l.id === lapId);
    if (!target) return;
    try {
      const seconds = roundToSeconds(target.elapsedMs);
      await onApply(soldierId, gradeKey, seconds);
      removeLap(lapId);
      setExpandedLapId(null);
      toast.success("הזמן הוחל בהצלחה");
    } catch {
      toast.error("שגיאה בהחלת הזמן");
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-w-md sm:max-w-md flex flex-col p-0 gap-0"
          style={{ height: "calc(100dvh - 2rem)", maxHeight: "calc(100dvh - 2rem)" }}
        >
          {/* Header with title + share + close. Auto close is disabled
              (showCloseButton={false}) so both buttons live in the flex flow
              and can't overlap. Buttons are grouped on one side and the title
              on the other, separated by `justify-between` — in RTL this
              parks the title at the right and the buttons at the left. */}
          <DialogHeader className="shrink-0 px-4 pt-4 pb-2 flex-row items-center justify-between gap-2">
            <DialogTitle className="text-sm text-muted-foreground font-normal">
              {activityName} <span className="mx-1">{">"}</span> {scoreLabel}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShareOpen(true)}
                aria-label="שיתוף"
                className="text-muted-foreground hover:text-foreground"
              >
                <QrCode size={16} />
              </Button>
              <DialogClose
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="סגור"
                    className="text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <X size={16} />
              </DialogClose>
            </div>
          </DialogHeader>
          <DialogDescription className="sr-only">סטופר לרישום זמני סיום</DialogDescription>

          {/* Big timer */}
          <div className="shrink-0 px-4 py-4 text-center">
            <div className="text-5xl font-bold tabular-nums tracking-tight" dir="ltr">
              {formatStopwatch(totalMs)}
            </div>
          </div>

          {/* Controls — DOM order is reversed visually because the dialog
              renders with a left-to-right writing direction. We want
              right-to-left in the Hebrew UI: clear (trash), play/pause, lap.
              That means DOM order must be: lap, play/pause, clear. */}
          <div className="shrink-0 flex items-center justify-center gap-6 pb-4">
            <Button
              variant="outline"
              size="icon-lg"
              className="h-14 w-14 rounded-full"
              onClick={lap}
              disabled={!isRunning}
              aria-label="הקפה"
            >
              <Flag size={20} />
            </Button>
            <Button
              variant="default"
              size="icon-lg"
              className="h-14 w-14 rounded-full"
              onClick={isRunning ? pause : start}
              aria-label={isRunning ? "השהה" : "התחל"}
            >
              {isRunning ? <Pause size={22} /> : <Play size={22} />}
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              className="h-14 w-14 rounded-full"
              onClick={() => setConfirmClear(true)}
              disabled={isRunning || !hasState}
              aria-label="נקה"
            >
              <Trash2 size={20} />
            </Button>
          </div>

          {/* Lap list */}
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-border">
            {state.laps.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                אין זמנים שנרשמו
              </div>
            ) : (
              state.laps.map((l, idx) => (
                <LapRow
                  key={l.id}
                  lap={l}
                  soldiers={soldiers}
                  expanded={expandedLapId === l.id}
                  onExpand={() => setExpandedLapId(l.id)}
                  onCollapse={() => setExpandedLapId(null)}
                  onApply={(soldierId) => handleApply(l.id, soldierId)}
                  onRequestDelete={() => setConfirmDeleteLapId(l.id)}
                  alternate={idx % 2 === 1}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear all confirmation */}
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>נקה את הסטופר</DialogTitle>
            <DialogDescription>
              פעולה זו תאפס את הזמן ותמחק את כל הזמנים שנרשמו. פעולה זו אינה ניתנת לביטול.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmClear(false)}>
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                reset();
                setConfirmClear(false);
                setExpandedLapId(null);
              }}
            >
              נקה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-row delete confirmation */}
      <Dialog
        open={confirmDeleteLapId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteLapId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחק זמן</DialogTitle>
            <DialogDescription>
              {lapToDelete
                ? `למחוק את הזמן ${formatStopwatch(lapToDelete.elapsedMs)} (${lapToDelete.number})?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteLapId(null)}>
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (confirmDeleteLapId) {
                  removeLap(confirmDeleteLapId);
                  if (expandedLapId === confirmDeleteLapId) setExpandedLapId(null);
                }
                setConfirmDeleteLapId(null);
              }}
            >
              מחק
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share / scan QR sub-modal */}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        activityId={activityId}
        scoreKey={scoreKey}
        laps={state.laps}
        onImport={importLaps}
        hasExistingState={hasState}
      />
    </>
  );
}
