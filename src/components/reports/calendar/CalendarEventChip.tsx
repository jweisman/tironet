"use client";

import Link from "next/link";
import { DoorOpen, Stethoscope, Thermometer } from "lucide-react";
import { ActivityTypeIcon } from "@/components/activities/ActivityTypeIcon";
import type { CalendarEventType } from "@/lib/calendar/events";
import type { PlatoonColor } from "@/lib/calendar/events";
import { cn } from "@/lib/utils";

const REQUEST_TYPE_ICONS: Partial<
  Record<CalendarEventType, React.ComponentType<{ size?: number; className?: string }>>
> = {
  leave: DoorOpen,
  medical_appointment: Stethoscope,
  sick_day: Thermometer,
};

interface CalendarEventChipProps {
  type: CalendarEventType;
  label: string;
  color: PlatoonColor;
  /** Activity type icon name (lucide key), only for activity events */
  activityIcon?: string | null;
  /** Link to the detail page */
  href: string;
}

export function CalendarEventChip({ type, label, color, activityIcon, href }: CalendarEventChipProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight truncate border hover:opacity-80 transition-opacity",
        color.bg,
        color.text,
        color.border,
      )}
      title={label}
    >
      {type === "activity" && activityIcon ? (
        <ActivityTypeIcon icon={activityIcon} name={label} size={10} className="shrink-0" />
      ) : (
        (() => {
          const Icon = REQUEST_TYPE_ICONS[type];
          return Icon ? <Icon size={10} className="shrink-0" /> : null;
        })()
      )}
      <span className="truncate">{label}</span>
    </Link>
  );
}
