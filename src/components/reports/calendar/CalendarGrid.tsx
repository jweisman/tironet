"use client";

import type { CalendarEvent, PlatoonColor } from "@/lib/calendar/events";
import { CalendarDayCell } from "./CalendarDayCell";

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

interface CalendarGridProps {
  year: number;
  month: number; // 0-indexed
  eventsByDate: Map<string, CalendarEvent[]>;
  getColor: (event: CalendarEvent) => PlatoonColor;
  todayStr: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function CalendarGrid({
  year,
  month,
  eventsByDate,
  getColor,
  todayStr,
}: CalendarGridProps) {
  // Build calendar grid — weeks start on Sunday (day 0)
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Previous month padding
  const prevMonthDays = new Date(year, month, 0).getDate();
  const cells: { date: string; dayNumber: number; isCurrentMonth: boolean }[] = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    cells.push({
      date: `${prevYear}-${pad(prevMonth + 1)}-${pad(d)}`,
      dayNumber: d,
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${year}-${pad(month + 1)}-${pad(d)}`,
      dayNumber: d,
      isCurrentMonth: true,
    });
  }

  // Next month padding to fill last week
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    for (let d = 1; d <= remaining; d++) {
      cells.push({
        date: `${nextYear}-${pad(nextMonth + 1)}-${pad(d)}`,
        dayNumber: d,
        isCurrentMonth: false,
      });
    }
  }

  return (
    <div>
        {/* Day name headers */}
        <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="text-center text-xs font-semibold text-muted-foreground py-1 border border-border bg-muted/50"
            >
              {name}
            </div>
          ))}
        </div>
        {/* Day cells */}
        <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
          {cells.map((cell) => (
            <CalendarDayCell
              key={cell.date}
              date={cell.date}
              dayNumber={cell.dayNumber}
              events={eventsByDate.get(cell.date) ?? []}
              isToday={cell.date === todayStr}
              isCurrentMonth={cell.isCurrentMonth}
              getColor={getColor}
            />
          ))}
        </div>
    </div>
  );
}
