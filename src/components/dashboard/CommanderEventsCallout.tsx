"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { useQuery } from "@powersync/react";

// ---------------------------------------------------------------------------
// Query: all commander events active today in scope
// Params: [cycleId, todayStr, todayStr]
// ---------------------------------------------------------------------------

const COMMANDER_EVENTS_QUERY = `
  SELECT
    ce.id, ce.user_id, ce.user_name, ce.name, ce.start_date, ce.end_date, ce.description
  FROM commander_events ce
  WHERE ce.cycle_id = ?
    AND ce.start_date <= ?
    AND ce.end_date >= ?
  ORDER BY ce.start_date ASC
`;

interface RawCommanderEvent {
  id: string;
  user_id: string;
  user_name: string;
  name: string;
  start_date: string;
  end_date: string;
  description: string | null;
}

export function CommanderEventsCallout({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const today = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  }, []);

  const { data: rawEvents } = useQuery<RawCommanderEvent>(
    COMMANDER_EVENTS_QUERY,
    [cycleId, today, today],
  );

  const events = rawEvents ?? [];
  if (events.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock size={14} className="text-muted-foreground" />
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          אירועי מפקדים היום
        </h2>
        <span className="text-xs text-muted-foreground">{events.length}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {events.map((ev) => {
          const startDisplay = new Date(ev.start_date + "T12:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" });
          const endDisplay = new Date(ev.end_date + "T12:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" });
          const dateRange = ev.start_date === ev.end_date ? startDisplay : `${startDisplay} — ${endDisplay}`;

          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => router.push(`/users?expand=${ev.user_id}`)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-muted/50 active:bg-muted"
            >
              <CalendarClock size={16} className="shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {ev.user_name}
                  <span className="text-muted-foreground font-normal"> · {ev.name}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {dateRange}
                  {ev.description && ` — ${ev.description}`}
                </p>
              </div>
              <ChevronLeft size={12} className="shrink-0 text-muted-foreground/40" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
