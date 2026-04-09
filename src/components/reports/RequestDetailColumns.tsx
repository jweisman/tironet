import { Fragment } from "react";
import type { DetailColumnsData } from "@/lib/reports/detail-columns";

export function RequestDetailColumns({ data }: { data: DetailColumnsData }) {
  if (data.fields.length === 0 && data.appointments.length === 0 && data.notes.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-col sm:flex-row sm:gap-6 text-xs">
      {/* Column 1: Structured fields */}
      {data.fields.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 shrink-0">
          {data.fields.map((d, i) => (
            <Fragment key={i}>
              <span className="font-medium text-muted-foreground whitespace-nowrap">{d.label}</span>
              <span className={d.highlight ? "font-bold text-foreground" : "text-foreground/80"}>{d.value}</span>
            </Fragment>
          ))}
        </div>
      )}

      {/* Column 2: Appointments */}
      {data.appointments.length > 0 && (
        <div className="mt-1 sm:mt-0 shrink-0">
          <span className="font-medium text-muted-foreground">תורים</span>
          <ul className="mt-0.5 mr-3 space-y-0">
            {data.appointments.map((a, i) => (
              <li key={i} className={`before:content-['–'] before:ml-1.5 before:text-muted-foreground/50 ${a.highlight ? "font-bold text-foreground" : "text-foreground/80"}`}>{a.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Column 3: Notes */}
      {data.notes.length > 0 && (
        <div className="mt-1 sm:mt-0 sm:border-r sm:border-border/50 sm:pr-4 space-y-0.5 border-t sm:border-t-0 border-border/50 pt-0.5 sm:pt-0">
          {data.notes.map((n, i) => (
            <p key={i} className="text-muted-foreground">
              <span className="font-medium">{n.label}:</span> {n.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
