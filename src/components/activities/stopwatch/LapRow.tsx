"use client";

import { useEffect, useState } from "react";
import { Check, Trash2, UserSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/SearchInput";
import { cn } from "@/lib/utils";
import { formatStopwatch, type Lap } from "@/lib/stopwatch/state";

export interface LapSoldier {
  id: string;
  givenName: string;
  familyName: string;
  rank: string | null;
}

interface LapRowProps {
  lap: Lap;
  soldiers: LapSoldier[];
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onApply: (soldierId: string) => void | Promise<void>;
  onRequestDelete: () => void;
  alternate?: boolean;
}

/**
 * One lap row.
 *
 * RTL note: the parent flex container in this dialog flows right-to-left, so
 * the first DOM child renders on the right (start of the row in Hebrew).
 * Reading order right-to-left is therefore: number, time, action buttons.
 *
 * Tapping the assign button (UserSearch icon) expands the row vertically —
 * the same number/time stays on top and a search field appears beneath.
 */
export function LapRow({
  lap,
  soldiers,
  expanded,
  onExpand,
  onCollapse,
  onApply,
  onRequestDelete,
  alternate,
}: LapRowProps) {
  const [search, setSearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [selectedSoldierId, setSelectedSoldierId] = useState<string | null>(null);

  // Reset internal state whenever the row is collapsed.
  useEffect(() => {
    if (!expanded) {
      setSearch("");
      setSelectedSoldierId(null);
    }
  }, [expanded]);

  const trimmed = search.trim().toLowerCase();
  const matches = trimmed
    ? soldiers.filter((s) =>
        `${s.familyName} ${s.givenName}`.toLowerCase().includes(trimmed),
      )
    : [];

  const selectedSoldier = selectedSoldierId
    ? soldiers.find((s) => s.id === selectedSoldierId) ?? null
    : null;

  async function handleApply() {
    if (!selectedSoldierId || applying) return;
    setApplying(true);
    try {
      await onApply(selectedSoldierId);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className={cn(
        "border-b border-border last:border-b-0",
        alternate ? "bg-muted/40" : "bg-background",
      )}
    >
      {/* Top: number + time + action buttons.
          DOM order matters in RTL — DOM[0] renders rightmost. */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="shrink-0 w-7 text-center text-base font-semibold tabular-nums">
          {lap.number}
        </span>
        <span className="flex-1 text-base font-medium tabular-nums text-center" dir="ltr">
          {formatStopwatch(lap.elapsedMs)}
        </span>
        {expanded ? (
          <>
            <Button
              variant="default"
              size="icon-sm"
              onClick={handleApply}
              disabled={!selectedSoldierId || applying}
              aria-label="החל"
            >
              <Check size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCollapse}
              aria-label="בטל"
              className="text-muted-foreground"
            >
              <X size={16} />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onExpand}
              aria-label="הקצה לחייל"
              className="text-muted-foreground hover:text-foreground"
            >
              <UserSearch size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRequestDelete}
              aria-label="מחק"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={16} />
            </Button>
          </>
        )}
      </div>

      {/* Expanded: soldier search / selection. */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {selectedSoldier ? (
            <button
              type="button"
              onClick={() => {
                setSelectedSoldierId(null);
                setSearch("");
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-start hover:bg-muted"
            >
              <span className="font-medium">
                {selectedSoldier.familyName} {selectedSoldier.givenName}
              </span>
              {selectedSoldier.rank && (
                <span className="ms-2 text-xs text-muted-foreground">
                  {selectedSoldier.rank}
                </span>
              )}
            </button>
          ) : (
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="חיפוש חייל"
              autoFocus
            />
          )}

          {!selectedSoldier && trimmed && (
            <div className="rounded-md border border-border bg-background max-h-56 overflow-y-auto">
              {matches.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                  לא נמצאו חיילים
                </div>
              ) : (
                matches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSoldierId(s.id)}
                    className="w-full text-start px-3 py-2 text-sm hover:bg-muted border-b border-border last:border-b-0"
                  >
                    <span className="font-medium">
                      {s.familyName} {s.givenName}
                    </span>
                    {s.rank && (
                      <span className="ms-2 text-xs text-muted-foreground">{s.rank}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
