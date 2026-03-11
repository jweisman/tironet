"use client";

import { useCycle } from "@/contexts/CycleContext";

export function CyclePicker({ compact = false }: { compact?: boolean }) {
  const { activeCycles, selectedCycleId, setSelectedCycleId } = useCycle();

  const uniqueCycles = activeCycles.filter(
    (a, i, arr) => arr.findIndex((b) => b.cycleId === a.cycleId) === i
  );

  if (uniqueCycles.length <= 1) return null;

  if (compact) {
    // Inline button group for mobile header
    return (
      <div className="flex gap-1">
        {uniqueCycles.map((a) => (
          <button
            key={a.cycleId}
            onClick={() => setSelectedCycleId(a.cycleId)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              a.cycleId === selectedCycleId
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {a.cycleName}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground px-1">מחזור</p>
      <div className="flex flex-col gap-1">
        {uniqueCycles.map((a) => (
          <button
            key={a.cycleId}
            onClick={() => setSelectedCycleId(a.cycleId)}
            className={`w-full text-start px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              a.cycleId === selectedCycleId
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {a.cycleName}
          </button>
        ))}
      </div>
    </div>
  );
}
