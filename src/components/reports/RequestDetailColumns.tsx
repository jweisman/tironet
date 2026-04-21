import { Fragment } from "react";
import type { DetailColumnsData } from "@/lib/reports/detail-columns";

export function RequestDetailColumns({ data }: { data: DetailColumnsData }) {
  if (data.fields.length === 0 && data.appointments.length === 0 && data.sickDays.length === 0 && data.notes.length === 0) {
    return null;
  }

  const colCount = [data.fields.length > 0, data.appointments.length > 0 || data.sickDays.length > 0, data.notes.length > 0].filter(Boolean).length;
  const gridClass = colCount === 3 ? "sm:grid-cols-3" : colCount === 2 ? "sm:grid-cols-2" : "";

  return (
    <div className={`mt-1.5 text-xs grid grid-cols-1 ${gridClass} gap-2 sm:gap-4`}>
      {data.fields.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 min-w-0">
          {data.fields.map((d, i) => (
            <Fragment key={i}>
              <span className="font-medium text-muted-foreground whitespace-nowrap">{d.label}</span>
              <span className={d.highlight ? "font-bold text-foreground" : "text-foreground/80"}>{d.value}</span>
            </Fragment>
          ))}
        </div>
      )}

      {data.appointments.length > 0 && (
        <div>
          <span className="font-medium text-muted-foreground">תורים</span>
          <ul className="mt-0.5 mr-3 space-y-0">
            {data.appointments.map((a, i) => (
              <li key={i} className={`before:content-['–'] before:ml-1.5 before:text-muted-foreground/50 ${a.highlight ? "font-bold text-foreground" : "text-foreground/80"}`}>{a.text}</li>
            ))}
          </ul>
        </div>
      )}

      {data.sickDays.length > 0 && (
        <div>
          <span className="font-medium text-muted-foreground">ימי מחלה</span>
          <ul className="mt-0.5 mr-3 space-y-0">
            {data.sickDays.map((d, i) => (
              <li key={i} className={`before:content-['–'] before:ml-1.5 before:text-muted-foreground/50 ${d.highlight ? "font-bold text-foreground" : "text-foreground/80"}`}>{d.text}</li>
            ))}
          </ul>
        </div>
      )}

      {data.notes.length > 0 && (
        <div className="space-y-0.5">
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
