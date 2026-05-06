"use client";

import { useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveScore } from "@/types/score-config";
import type { GradeKey } from "../ActivityDetail";
import { StopwatchDialog } from "./StopwatchDialog";
import type { LapSoldier } from "./LapRow";

interface StopwatchButtonProps {
  activityId: string;
  activityName: string;
  activeScores: ActiveScore[];
  soldiers: LapSoldier[];
  onApply: (soldierId: string, gradeKey: GradeKey, seconds: number) => Promise<void>;
}

export function StopwatchButton({
  activityId,
  activityName,
  activeScores,
  soldiers,
  onApply,
}: StopwatchButtonProps) {
  const timeScores = useMemo(
    () => activeScores.filter((s) => s.format === "time"),
    [activeScores],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stopwatchOpen, setStopwatchOpen] = useState(false);
  const [selectedScore, setSelectedScore] = useState<ActiveScore | null>(null);
  // `openCount` increments on every "open" click and is used as the React key
  // for `<StopwatchDialog>` so it remounts on each open. Without this, the
  // hook's lazy useState initializer (which calls loadFreshState) only runs
  // the first time the dialog appears — the freshness check would never
  // re-evaluate when the user closes and reopens, leaving stale terminal
  // state from a finished session visible.
  const [openCount, setOpenCount] = useState(0);

  if (timeScores.length === 0) return null;

  function handleClick() {
    if (timeScores.length === 1) {
      setSelectedScore(timeScores[0]);
      setOpenCount((c) => c + 1);
      setStopwatchOpen(true);
    } else {
      setPickerOpen(true);
    }
  }

  function handlePick(score: ActiveScore) {
    setSelectedScore(score);
    setOpenCount((c) => c + 1);
    setPickerOpen(false);
    setStopwatchOpen(true);
  }

  return (
    <>
      <Button
        data-tour="activity-stopwatch"
        size="sm"
        variant="outline"
        onClick={handleClick}
        aria-label="סטופר"
      >
        <Timer size={14} className="me-1" />
        סטופר
      </Button>

      {/* Score picker — only used when there are multiple time scores. */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>בחר ציון</DialogTitle>
            <DialogDescription>בחר את הציון שעבורו תרצה לתעד זמנים</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {timeScores.map((score) => (
              <Button
                key={score.key}
                variant="outline"
                onClick={() => handlePick(score)}
                className="justify-start"
              >
                {score.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {selectedScore && (
        <StopwatchDialog
          key={openCount}
          open={stopwatchOpen}
          onOpenChange={setStopwatchOpen}
          activityId={activityId}
          activityName={activityName}
          scoreKey={selectedScore.key}
          gradeKey={selectedScore.gradeKey}
          scoreLabel={selectedScore.label}
          soldiers={soldiers}
          onApply={onApply}
        />
      )}
    </>
  );
}
