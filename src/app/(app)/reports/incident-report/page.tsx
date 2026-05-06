"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import {
  INCIDENT_TYPE_LABELS,
  getSubtypeLabel,
  type IncidentType,
} from "@/lib/incidents/constants";
import type {
  IncidentReportData,
  IncidentReportEntry,
} from "@/app/api/reports/incident-report/route";

const INCIDENT_TYPES: IncidentType[] = ["commendation", "discipline", "safety"];

const TYPE_COLOR_BG: Record<IncidentType, string> = {
  commendation:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  discipline:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  safety: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const TYPE_BAR_COLOR: Record<IncidentType, string> = {
  commendation: "#16a34a",
  discipline: "#d97706",
  safety: "#dc2626",
};

function formatHebrewDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function TypeBadge({ type }: { type: string }) {
  const t = type as IncidentType;
  const cls = TYPE_COLOR_BG[t] ?? "bg-muted text-muted-foreground";
  const label = INCIDENT_TYPE_LABELS[t] ?? type;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function niceCeil(value: number): number {
  if (value <= 4) return Math.max(1, Math.ceil(value));
  if (value <= 10) return Math.ceil(value / 2) * 2;
  if (value <= 50) return Math.ceil(value / 5) * 5;
  return Math.ceil(value / 10) * 10;
}

function BarChart({ data }: { data: IncidentReportData }) {
  if (data.groups.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground text-center py-8">
        אין נתונים להצגה
      </p>
    );
  }

  const maxVal = Math.max(
    1,
    ...data.groups.flatMap((g) => INCIDENT_TYPES.map((t) => g.counts[t])),
  );
  const yMax = niceCeil(maxVal);
  const yTicks = 4;

  const padTop = 16;
  const padBottom = 56;
  const padLeft = 36;
  const padRight = 16;
  const groupWidth = 110;
  const groupGap = 16;
  const barWidth = 26;
  const barGap = 4;

  const innerWidth =
    data.groups.length * groupWidth + (data.groups.length - 1) * groupGap;
  const width = padLeft + innerWidth + padRight;
  const height = 240;
  const chartHeight = height - padTop - padBottom;

  const yFor = (value: number) =>
    padTop + chartHeight - (value / yMax) * chartHeight;

  const ticks: { y: number; label: number }[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax * i) / yTicks;
    ticks.push({ y: yFor(v), label: Math.round(v) });
  }

  return (
    <div className="flex justify-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", maxWidth: width, height: "auto" }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padLeft}
              y1={t.y}
              x2={width - padRight}
              y2={t.y}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
            <text
              x={padLeft - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#6b7280"
            >
              {t.label}
            </text>
          </g>
        ))}
        <line
          x1={padLeft}
          y1={padTop + chartHeight}
          x2={width - padRight}
          y2={padTop + chartHeight}
          stroke="#1f2937"
          strokeWidth="1"
        />
        {data.groups.map((group, gi) => {
          // RTL: first group (gi=0) on the right, last on the left
          const reverseGroupIdx = data.groups.length - 1 - gi;
          const groupLeft = padLeft + reverseGroupIdx * (groupWidth + groupGap);
          const totalBarsWidth =
            INCIDENT_TYPES.length * barWidth +
            (INCIDENT_TYPES.length - 1) * barGap;
          const barsLeft = groupLeft + (groupWidth - totalBarsWidth) / 2;
          return (
            <g key={group.id}>
              {INCIDENT_TYPES.map((type, ti) => {
                // RTL: first type (commendation) on right, matching legend order
                const reverseTypeIdx = INCIDENT_TYPES.length - 1 - ti;
                const count = group.counts[type];
                const barHeight = (count / yMax) * chartHeight;
                const x = barsLeft + reverseTypeIdx * (barWidth + barGap);
                const y = padTop + chartHeight - barHeight;
                return (
                  <g key={type}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={TYPE_BAR_COLOR[type]}
                    />
                    {count > 0 && (
                      <text
                        x={x + barWidth / 2}
                        y={y - 3}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="600"
                        fill="#1f2937"
                      >
                        {count}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={groupLeft + groupWidth / 2}
                y={padTop + chartHeight + 18}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="currentColor"
              >
                {group.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function IncidentRow({
  inc,
  showSquadMeta,
}: {
  inc: IncidentReportEntry;
  showSquadMeta: boolean;
}) {
  const subtypeLabel = getSubtypeLabel(inc.type, inc.subtype);
  return (
    <tr className="border-b border-border align-top">
      <td className="py-2 px-2 whitespace-nowrap text-xs text-muted-foreground">
        {formatHebrewDate(inc.date)}
      </td>
      <td className="py-2 px-2">
        <TypeBadge type={inc.type} />
        {subtypeLabel && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {subtypeLabel}
          </div>
        )}
      </td>
      <td className="py-2 px-2">
        <div className="font-semibold text-sm">{inc.soldierName}</div>
        {showSquadMeta && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {inc.squadName}
          </div>
        )}
      </td>
      <td className="py-2 px-2">
        <div className="whitespace-pre-wrap text-sm">{inc.description}</div>
        {inc.response && (
          <div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
            <span className="font-semibold">תגובה: </span>
            {inc.response}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function IncidentReportPage() {
  const router = useRouter();
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<IncidentReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    fetch(`/api/reports/incident-report?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: IncidentReportData) => setData(d))
      .catch(() => toast.error("שגיאה בטעינת הדוח"))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      const res = await fetch(`/api/reports/incident-report/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().split("T")[0];
      a.download = `incidents-${today}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("הדוח הופק בהצלחה");
    } catch {
      toast.error("שגיאה בהפקת ה-PDF");
    } finally {
      setPdfLoading(false);
    }
  }

  if (cycleLoading) return null;

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
      </div>
    );
  }

  const totalCount = data
    ? data.totals.commendation + data.totals.discipline + data.totals.safety
    : 0;

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/reports")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowRight size={20} />
          </button>
          <h1 className="text-lg font-bold flex-1">דוח אירועים</h1>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={pdfLoading || loading}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {pdfLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            <span className="hidden sm:inline">ייצוא ל-PDF</span>
          </button>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground mt-1">
            מחזור {data.cycleName}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-6 pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Summary */}
            <div className="text-center">
              <p className="text-lg font-bold">סה״כ אירועים: {totalCount}</p>
            </div>

            {/* Chart + legend */}
            <div className="rounded-xl border border-border bg-background p-4">
              <BarChart data={data} />
              <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs">
                {INCIDENT_TYPES.map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ background: TYPE_BAR_COLOR[t] }}
                    />
                    {INCIDENT_TYPE_LABELS[t]} ({data.totals[t]})
                  </span>
                ))}
              </div>
            </div>

            {/* Groups */}
            {data.groups.map((group) => {
              const groupTotal =
                group.counts.commendation +
                group.counts.discipline +
                group.counts.safety;
              return (
                <div key={group.id}>
                  <div className="bg-foreground text-background px-3 py-2 rounded-lg mb-3 font-bold text-sm">
                    {group.name}
                    <span className="font-normal text-xs ms-2">
                      ({groupTotal})
                    </span>
                  </div>
                  {group.incidents.length === 0 ? (
                    <p className="text-sm italic text-muted-foreground text-center py-4">
                      אין אירועים
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b-2 border-border">
                            <th className="text-start py-1.5 px-2 font-semibold w-[14%] whitespace-nowrap">
                              תאריך
                            </th>
                            <th className="text-start py-1.5 px-2 font-semibold w-[16%]">
                              סוג
                            </th>
                            <th className="text-start py-1.5 px-2 font-semibold w-[22%]">
                              חייל
                            </th>
                            <th className="text-start py-1.5 px-2 font-semibold">
                              תיאור
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.incidents.map((inc) => (
                            <IncidentRow
                              key={inc.id}
                              inc={inc}
                              showSquadMeta={data.groupBy === "platoon"}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
