"use client";

import type { PlatoonColor, CalendarEventType } from "@/lib/calendar/events";
import { EVENT_TYPE_LABELS, EVENT_TYPE_COLORS } from "@/lib/calendar/events";

interface PlatoonLegendProps {
  mode: "platoon";
  platoons: { id: string; name: string }[];
  colorMap: Map<string, PlatoonColor>;
}

interface TypeLegendProps {
  mode: "type";
  visibleTypes: CalendarEventType[];
}

type CalendarLegendProps = PlatoonLegendProps | TypeLegendProps;

export function CalendarLegend(props: CalendarLegendProps) {
  if (props.mode === "platoon") {
    return (
      <div className="flex flex-wrap gap-3">
        {props.platoons.map((p) => {
          const color = props.colorMap.get(p.id);
          if (!color) return null;
          return (
            <div key={p.id} className="flex items-center gap-1.5 text-xs">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color.hex }}
              />
              <span>{p.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {props.visibleTypes.map((type) => {
        const color = EVENT_TYPE_COLORS[type];
        return (
          <div key={type} className="flex items-center gap-1.5 text-xs">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color.hex }}
            />
            <span>{EVENT_TYPE_LABELS[type]}</span>
          </div>
        );
      })}
    </div>
  );
}
