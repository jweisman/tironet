"use client";

import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface MonthNavProps {
  year: number;
  month: number; // 0-indexed
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}

export function MonthNav({ year, month, onPrev, onNext, canGoPrev, canGoNext }: MonthNavProps) {
  const monthName = new Date(year, month, 1).toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex items-center justify-between mb-3">
      {/* RTL: right arrow = go back (prev), left arrow = go forward (next) */}
      <button
        type="button"
        onClick={onPrev}
        disabled={!canGoPrev}
        className={cn(
          "p-2 rounded-lg transition-colors",
          canGoPrev
            ? "text-muted-foreground hover:bg-muted hover:text-foreground"
            : "text-muted-foreground/30 cursor-default",
        )}
      >
        <ChevronRight size={20} />
      </button>
      <h2 className="text-base font-bold">{monthName}</h2>
      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        className={cn(
          "p-2 rounded-lg transition-colors",
          canGoNext
            ? "text-muted-foreground hover:bg-muted hover:text-foreground"
            : "text-muted-foreground/30 cursor-default",
        )}
      >
        <ChevronLeft size={20} />
      </button>
    </div>
  );
}
