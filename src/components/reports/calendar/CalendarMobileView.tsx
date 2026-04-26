"use client";

import { useState } from "react";
import Link from "next/link";
import { DoorOpen, Stethoscope, Thermometer } from "lucide-react";
import { ActivityTypeIcon } from "@/components/activities/ActivityTypeIcon";
import type { CalendarEvent, CalendarEventType, PlatoonColor } from "@/lib/calendar/events";
import { EVENT_TYPE_LABELS, getEventHref } from "@/lib/calendar/events";
import { cn } from "@/lib/utils";

const DAY_NAMES = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const REQUEST_TYPE_ICONS: Partial<
  Record<CalendarEventType, React.ComponentType<{ size?: number; className?: string }>>
> = {
  leave: DoorOpen,
  medical_appointment: Stethoscope,
  sick_day: Thermometer,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface CalendarMobileViewProps {
  year: number;
  month: number; // 0-indexed
  eventsByDate: Map<string, CalendarEvent[]>;
  getColor: (event: CalendarEvent) => PlatoonColor;
  todayStr: string;
}

export function CalendarMobileView({
  year,
  month,
  eventsByDate,
  getColor,
  todayStr,
}: CalendarMobileViewProps) {
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Build grid cells
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: { date: string; dayNumber: number; isCurrentMonth: boolean }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    cells.push({ date: `${py}-${pad(pm + 1)}-${pad(d)}`, dayNumber: d, isCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, dayNumber: d, isCurrentMonth: true });
  }

  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ date: `${ny}-${pad(nm + 1)}-${pad(d)}`, dayNumber: d, isCurrentMonth: false });
    }
  }

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];

  function getDotsForDate(date: string): string[] {
    const events = eventsByDate.get(date);
    if (!events || events.length === 0) return [];
    const seen = new Set<string>();
    const dots: string[] = [];
    for (const e of events) {
      const color = getColor(e);
      if (!seen.has(color.hex)) {
        seen.add(color.hex);
        dots.push(color.hex);
        if (dots.length >= 3) break;
      }
    }
    return dots;
  }

  return (
    <div>
      {/* Day name headers */}
      <div className="grid mb-1" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center text-xs font-medium text-muted-foreground py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid — compact cells with dots */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {cells.map((cell) => {
          const isToday = cell.date === todayStr;
          const isSelected = cell.date === selectedDate;
          const dots = getDotsForDate(cell.date);

          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => setSelectedDate(cell.date)}
              className={cn(
                "flex flex-col items-center py-1.5 transition-colors",
                !cell.isCurrentMonth && "opacity-30",
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-full text-sm",
                  isToday && !isSelected && "font-bold text-primary",
                  isSelected && "bg-primary text-primary-foreground font-bold",
                )}
              >
                {cell.dayNumber}
              </div>
              <div className="flex gap-0.5 mt-0.5 h-1.5">
                {dots.map((hex, i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day event list */}
      <div className="mt-4 border-t border-border pt-3">
        <h3 className="text-sm font-semibold mb-2">
          {new Date(selectedDate + "T12:00:00").toLocaleDateString("he-IL", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h3>
        {selectedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">אין אירועים</p>
        ) : (
          <div className="space-y-1">
            {selectedEvents.map((event) => {
              const color = getColor(event);
              return (
                <Link
                  key={event.id}
                  href={getEventHref(event)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div
                    className="w-1 self-stretch rounded-full shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="shrink-0" style={{ color: color.hex }}>
                    {event.type === "activity" && event.icon ? (
                      <ActivityTypeIcon icon={event.icon} name={event.label} size={18} />
                    ) : (
                      (() => {
                        const Icon = REQUEST_TYPE_ICONS[event.type];
                        return Icon ? <Icon size={18} /> : null;
                      })()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{event.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {EVENT_TYPE_LABELS[event.type]}
                      {event.platoonName && ` · ${event.platoonName}`}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
