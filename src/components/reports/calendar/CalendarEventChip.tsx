"use client";

import Link from "next/link";
import { DoorOpen, Stethoscope, Thermometer, CalendarClock } from "lucide-react";
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
  commander_event: CalendarClock,
};

interface CalendarEventChipProps {
  type: CalendarEventType;
  label: string;
  color: PlatoonColor;
  /** Activity type icon name (lucide key), only for activity events */
  activityIcon?: string | null;
  /** Link to the detail page (null = no link) */
  href: string | null;
}

export function CalendarEventChip({ type, label, color, activityIcon, href }: CalendarEventChipProps) {
  const classes = cn(
    "flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight truncate border",
    color.bg,
    color.text,
    color.border,
    href && "hover:opacity-80 transition-opacity",
  );

  const iconEl = (type === "activity" || type === "commander_event") && activityIcon ? (
    <ActivityTypeIcon icon={activityIcon} name={label} size={10} className="shrink-0" />
  ) : (
    (() => {
      const Icon = REQUEST_TYPE_ICONS[type];
      return Icon ? <Icon size={10} className="shrink-0" /> : null;
    })()
  );

  const content = (
    <>
      {iconEl}
      <span className="truncate">{label}</span>
    </>
  );

  if (!href) {
    return <div className={classes} title={label}>{content}</div>;
  }

  return (
    <Link href={href} className={classes} title={label}>
      {content}
    </Link>
  );
}
