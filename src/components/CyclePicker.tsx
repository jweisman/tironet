"use client";

import { useCycle } from "@/contexts/CycleContext";
import { Card } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export function CyclePicker({ onSelected }: { onSelected?: () => void }) {
  const { activeCycles, setSelectedCycleId } = useCycle();

  function select(cycleId: string) {
    setSelectedCycleId(cycleId);
    onSelected?.();
  }

  return (
    <div className="max-w-sm mx-auto mt-8 space-y-4">
      <div>
        <h2 className="text-xl font-bold">בחר מחזור</h2>
        <p className="text-muted-foreground text-sm mt-1">
          אתה משויך למספר מחזורים. בחר עם איזה תרצה לעבוד.
        </p>
      </div>
      <div className="grid gap-3">
        {activeCycles.map((a) => (
          <Card
            key={`${a.cycleId}-${a.unitId}`}
            className="p-4 cursor-pointer hover:border-primary transition-colors"
            onClick={() => select(a.cycleId)}
          >
            <div className="font-medium">{a.cycleName}</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {ROLE_LABELS[a.role as Role]}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
