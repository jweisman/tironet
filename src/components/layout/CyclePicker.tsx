"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useCycle } from "@/contexts/CycleContext";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Role } from "@/types";

export function CyclePicker({ compact = false }: { compact?: boolean }) {
  const { activeCycles, selectedCycleId, setSelectedCycleId } = useCycle();
  const [dialogOpen, setDialogOpen] = useState(false);

  const uniqueCycles = activeCycles.filter(
    (a, i, arr) => arr.findIndex((b) => b.cycleId === a.cycleId) === i
  );

  if (uniqueCycles.length <= 1) return null;

  const selectedName = uniqueCycles.find((a) => a.cycleId === selectedCycleId)?.cycleName ?? "בחר מחזור";

  function select(cycleId: string) {
    setSelectedCycleId(cycleId);
    setDialogOpen(false);
  }

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
          style={{ maxWidth: 80 }}
        >
          <span className="truncate min-w-0">{selectedName}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>בחר מחזור</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              {activeCycles.map((a) => (
                <button
                  key={`${a.cycleId}-${a.unitId}`}
                  type="button"
                  onClick={() => select(a.cycleId)}
                  className={`w-full rounded-lg border p-3 text-start transition-colors ${
                    a.cycleId === selectedCycleId
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <p className="font-medium text-sm">{a.cycleName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ROLE_LABELS[a.role as Role]}</p>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground px-1">מחזור</p>
      <div className="flex rounded-lg bg-muted p-0.5">
        {uniqueCycles.map((a) => (
          <button
            key={a.cycleId}
            onClick={() => setSelectedCycleId(a.cycleId)}
            className={`flex-1 min-w-0 truncate px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
              a.cycleId === selectedCycleId
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {a.cycleName}
          </button>
        ))}
      </div>
    </div>
  );
}
