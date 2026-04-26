"use client";

import type { CalendarEvent, PlatoonColor } from "@/lib/calendar/events";
import { getEventHref } from "@/lib/calendar/events";
import { CalendarEventChip } from "./CalendarEventChip";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_EVENTS = 6;

interface CalendarDayCellProps {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  events: CalendarEvent[];
  isToday: boolean;
  isCurrentMonth: boolean;
  getColor: (event: CalendarEvent) => PlatoonColor;
}

export function CalendarDayCell({
  dayNumber,
  events,
  isToday,
  isCurrentMonth,
  getColor,
}: CalendarDayCellProps) {
  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);
  const overflow = events.length - MAX_VISIBLE_EVENTS;

  return (
    <div
      className={cn(
        "min-h-[80px] border border-border p-1 text-start",
        !isCurrentMonth && "bg-muted/30",
      )}
    >
      <div
        className={cn(
          "text-xs font-medium mb-0.5 w-5 h-5 flex items-center justify-center rounded-full",
          isToday && "bg-primary text-primary-foreground",
          !isCurrentMonth && "text-muted-foreground",
        )}
      >
        {dayNumber}
      </div>
      <div className="space-y-0.5">
        {visibleEvents.map((event) => (
          <CalendarEventChip
            key={event.id}
            type={event.type}
            label={event.label}
            color={getColor(event)}
            activityIcon={event.icon}
            href={getEventHref(event)}
          />
        ))}
        {overflow > 0 && (
          <div className="text-[10px] text-muted-foreground px-1">
            +{overflow} נוספים
          </div>
        )}
      </div>
    </div>
  );
}
