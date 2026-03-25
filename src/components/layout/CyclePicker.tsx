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
      <div className="flex rounded-lg bg-muted p-0.5">
        {uniqueCycles.map((a) => (
          <button
            key={a.cycleId}
            onClick={() => setSelectedCycleId(a.cycleId)}
            className={`flex-1 min-w-0 truncate px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              a.cycleId === selectedCycleId
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
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
