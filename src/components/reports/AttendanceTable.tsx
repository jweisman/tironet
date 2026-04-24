"use client";

import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/reports/render-attendance";

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "נוכח",
  leave: "יציאה",
  medical_appointment: "תור רפואי",
  sick_day: "יום מחלה",
  inactive: "לא פעיל",
};

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: "bg-green-100 text-green-800",
  leave: "bg-amber-100 text-amber-800",
  medical_appointment: "bg-blue-100 text-blue-800",
  sick_day: "bg-pink-100 text-pink-800",
  inactive: "bg-muted text-muted-foreground",
};

export interface AttendanceRow {
  id?: string;
  name: string;
  squad?: string;
  status: AttendanceStatus | string;
  reason: string | null;
}

interface Props {
  rows: AttendanceRow[];
  showSquad?: boolean;
}

export function AttendanceTable({ rows, showSquad = true }: Props) {
  if (rows.length === 0) {
    return <p className="text-xs text-green-600 font-medium">כולם נוכחים</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="text-start px-2 py-1.5 font-semibold">חייל</th>
            {showSquad && <th className="text-start px-2 py-1.5 font-semibold">כיתה</th>}
            <th className="text-start px-2 py-1.5 font-semibold">סטטוס</th>
            <th className="text-start px-2 py-1.5 font-semibold">סיבה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const statusKey = s.status as AttendanceStatus;
            const label = STATUS_LABELS[statusKey] ?? s.status;
            const color = STATUS_COLORS[statusKey] ?? "bg-muted text-muted-foreground";
            return (
              <tr key={s.id ?? i} className="border-b border-border">
                <td className="px-2 py-1.5">{s.name}</td>
                {showSquad && <td className="px-2 py-1.5">{s.squad ?? ""}</td>}
                <td className="px-2 py-1.5">
                  <span className={cn("inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded", color)}>
                    {label}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{s.reason ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
