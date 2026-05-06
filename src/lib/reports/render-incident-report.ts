import { prisma } from "@/lib/db/prisma";
import { escapeHtml, formatDate } from "@/lib/reports/html-helpers";
import {
  INCIDENT_TYPE_LABELS,
  getSubtypeLabel,
  type IncidentType,
} from "@/lib/incidents/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncidentReportEntry {
  id: string;
  soldierId: string;
  soldierName: string;
  squadName: string;
  type: IncidentType | string;
  subtype: string | null;
  date: string; // YYYY-MM-DD
  description: string;
  response: string | null;
  createdByName: string;
}

export interface IncidentReportGroup {
  id: string;
  name: string;
  counts: Record<IncidentType, number>;
  incidents: IncidentReportEntry[];
}

export interface IncidentReportData {
  cycleName: string;
  groupBy: "squad" | "platoon";
  groups: IncidentReportGroup[];
  totals: Record<IncidentType, number>;
}

const INCIDENT_TYPES: IncidentType[] = ["commendation", "discipline", "safety"];

export const INCIDENT_TYPE_COLORS: Record<IncidentType, string> = {
  commendation: "#16a34a", // green-600
  discipline: "#d97706", // amber-600
  safety: "#dc2626", // red-600
};

const INCIDENT_TYPE_BG: Record<IncidentType, string> = {
  commendation: "#dcfce7",
  discipline: "#fef3c7",
  safety: "#fee2e2",
};

const INCIDENT_TYPE_TEXT: Record<IncidentType, string> = {
  commendation: "#166534",
  discipline: "#92400e",
  safety: "#991b1b",
};

function emptyCounts(): Record<IncidentType, number> {
  return { commendation: 0, discipline: 0, safety: 0 };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/**
 * Fetch incidents for a cycle, grouped by squad (when role is platoon_commander)
 * or by platoon (when role is company_commander).
 */
export async function fetchIncidentReport(
  cycleId: string,
  platoonIds: string[],
  groupBy: "squad" | "platoon",
): Promise<IncidentReportData | null> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  const soldiers = await prisma.soldier.findMany({
    where: {
      cycleId,
      squad: { platoon: { id: { in: platoonIds } } },
    },
    include: {
      squad: {
        include: {
          platoon: {
            include: { company: { select: { name: true, sortOrder: true } } },
          },
        },
      },
      incidents: {
        orderBy: { date: "desc" },
        select: {
          id: true,
          type: true,
          subtype: true,
          date: true,
          description: true,
          response: true,
          createdByName: true,
        },
      },
    },
    orderBy: [
      { squad: { platoon: { company: { sortOrder: "asc" } } } },
      { squad: { platoon: { sortOrder: "asc" } } },
      { squad: { sortOrder: "asc" } },
      { familyName: "asc" },
      { givenName: "asc" },
    ],
  });

  const groupMap = new Map<string, IncidentReportGroup>();
  const groupOrder: string[] = [];
  const totals = emptyCounts();

  for (const s of soldiers) {
    const groupId = groupBy === "squad" ? s.squad.id : s.squad.platoon.id;
    const groupName =
      groupBy === "squad"
        ? s.squad.name
        : `${s.squad.platoon.company.name} — ${s.squad.platoon.name}`;

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        id: groupId,
        name: groupName,
        counts: emptyCounts(),
        incidents: [],
      });
      groupOrder.push(groupId);
    }

    const group = groupMap.get(groupId)!;

    for (const inc of s.incidents) {
      const type = inc.type as IncidentType;
      if (type in group.counts) {
        group.counts[type]++;
        totals[type]++;
      }
      group.incidents.push({
        id: inc.id,
        soldierId: s.id,
        soldierName: `${s.familyName} ${s.givenName}`,
        squadName: s.squad.name,
        type: inc.type,
        subtype: inc.subtype,
        date: inc.date.toISOString().split("T")[0],
        description: inc.description,
        response: inc.response,
        createdByName: inc.createdByName,
      });
    }
  }

  // Sort each group's incidents by date descending (already roughly ordered by
  // soldier-level Prisma sort, but soldiers from different squads/platoons
  // interleave here so re-sort to enforce strict date desc within the group).
  for (const group of groupMap.values()) {
    group.incidents.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  return {
    cycleName: cycle.name,
    groupBy,
    groups: groupOrder.map((id) => groupMap.get(id)!),
    totals,
  };
}

// ---------------------------------------------------------------------------
// Bar chart SVG
// ---------------------------------------------------------------------------

/**
 * Render a grouped bar chart as inline SVG. One x-axis category per group,
 * three bars per category (commendation/discipline/safety).
 */
export function renderBarChartSvg(data: IncidentReportData): string {
  const groups = data.groups;
  if (groups.length === 0) {
    return `<div class="no-data">אין נתונים להצגה</div>`;
  }

  // Compute max value for y-axis scaling. Round up to a sensible tick.
  const maxVal = Math.max(
    1,
    ...groups.flatMap((g) => INCIDENT_TYPES.map((t) => g.counts[t])),
  );
  const yMax = niceCeil(maxVal);
  const yTicks = 4;

  // Layout
  const padTop = 16;
  const padBottom = 56; // room for category labels
  const padLeft = 36;
  const padRight = 16;
  const groupWidth = 110;
  const groupGap = 16;
  const barWidth = 26;
  const barGap = 4;

  const innerWidth = groups.length * groupWidth + (groups.length - 1) * groupGap;
  const width = padLeft + innerWidth + padRight;
  const height = 240;
  const chartHeight = height - padTop - padBottom;

  function yFor(value: number): number {
    return padTop + chartHeight - (value / yMax) * chartHeight;
  }

  // Y-axis gridlines + tick labels
  const gridlines: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax * i) / yTicks;
    const y = yFor(v);
    gridlines.push(
      `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`,
    );
    gridlines.push(
      `<text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#6b7280">${Math.round(v)}</text>`,
    );
  }

  // Bars per group
  const groupVisuals: string[] = [];
  const labels: string[] = [];

  groups.forEach((group, gi) => {
    const groupLeft = padLeft + gi * (groupWidth + groupGap);
    const totalBarsWidth = INCIDENT_TYPES.length * barWidth + (INCIDENT_TYPES.length - 1) * barGap;
    const barsLeft = groupLeft + (groupWidth - totalBarsWidth) / 2;

    INCIDENT_TYPES.forEach((type, ti) => {
      const count = group.counts[type];
      const barHeight = (count / yMax) * chartHeight;
      const x = barsLeft + ti * (barWidth + barGap);
      const y = padTop + chartHeight - barHeight;
      groupVisuals.push(
        `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${INCIDENT_TYPE_COLORS[type]}"/>`,
      );
      if (count > 0) {
        groupVisuals.push(
          `<text x="${x + barWidth / 2}" y="${y - 3}" text-anchor="middle" font-size="9" font-weight="600" fill="#1f2937">${count}</text>`,
        );
      }
    });

    // Category label below the chart
    const labelX = groupLeft + groupWidth / 2;
    labels.push(
      `<text x="${labelX}" y="${padTop + chartHeight + 18}" text-anchor="middle" font-size="11" font-weight="600" fill="#1f2937">${escapeHtml(group.name)}</text>`,
    );
  });

  // X-axis baseline
  const baseline = `<line x1="${padLeft}" y1="${padTop + chartHeight}" x2="${width - padRight}" y2="${padTop + chartHeight}" stroke="#1f2937" stroke-width="1"/>`;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines.join("\n")}
    ${baseline}
    ${groupVisuals.join("\n")}
    ${labels.join("\n")}
  </svg>`;
}

function niceCeil(value: number): number {
  if (value <= 4) return Math.max(1, Math.ceil(value));
  if (value <= 10) return Math.ceil(value / 2) * 2;
  if (value <= 50) return Math.ceil(value / 5) * 5;
  return Math.ceil(value / 10) * 10;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

export function renderIncidentReportHtml(data: IncidentReportData): string {
  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const totalCount =
    data.totals.commendation + data.totals.discipline + data.totals.safety;

  function typeBadge(type: string): string {
    const t = type as IncidentType;
    const label = INCIDENT_TYPE_LABELS[t] ?? type;
    const bg = INCIDENT_TYPE_BG[t] ?? "#f3f4f6";
    const fg = INCIDENT_TYPE_TEXT[t] ?? "#1f2937";
    return `<span class="badge" style="background:${bg};color:${fg};">${escapeHtml(label)}</span>`;
  }

  const legendHtml = INCIDENT_TYPES.map(
    (t) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${INCIDENT_TYPE_COLORS[t]}"></span> ${INCIDENT_TYPE_LABELS[t]} (${data.totals[t]})</span>`,
  ).join("");

  const chartSvg = renderBarChartSvg(data);

  const groupsHtml = data.groups
    .map((group) => {
      const incidentRows =
        group.incidents.length === 0
          ? `<tr><td colspan="4" class="no-incidents">אין אירועים</td></tr>`
          : group.incidents
              .map((inc) => {
                const subtypeLabel = getSubtypeLabel(inc.type, inc.subtype);
                const typeAndSubtype = `${typeBadge(inc.type)}${
                  subtypeLabel ? `<div class="subtype">${escapeHtml(subtypeLabel)}</div>` : ""
                }`;
                const responseHtml = inc.response
                  ? `<div class="response"><span class="response-label">תגובה:</span> ${escapeHtml(inc.response)}</div>`
                  : "";
                return `
                  <tr>
                    <td class="date-cell">${formatDate(inc.date)}</td>
                    <td class="type-cell">${typeAndSubtype}</td>
                    <td class="soldier-cell">
                      <div class="soldier-name">${escapeHtml(inc.soldierName)}</div>
                      ${data.groupBy === "platoon" ? `<div class="squad-meta">${escapeHtml(inc.squadName)}</div>` : ""}
                    </td>
                    <td class="desc-cell">
                      <div class="description">${escapeHtml(inc.description)}</div>
                      ${responseHtml}
                    </td>
                  </tr>`;
              })
              .join("\n");

      const groupTotal =
        group.counts.commendation + group.counts.discipline + group.counts.safety;

      return `
        <div class="group-section">
          <div class="group-header">
            ${escapeHtml(group.name)}
            <span class="count">(${groupTotal})</span>
          </div>
          <table>
            <thead>
              <tr>
                <th class="date-col">תאריך</th>
                <th class="type-col">סוג</th>
                <th class="soldier-col">חייל</th>
                <th>תיאור</th>
              </tr>
            </thead>
            <tbody>${incidentRows}</tbody>
          </table>
        </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>דוח אירועים — ${escapeHtml(data.cycleName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans Hebrew', sans-serif;
      font-size: 12px;
      color: #1a1a1a;
      direction: rtl;
      padding: 20mm;
    }
    @page { size: A4; margin: 15mm; }
    .page-header {
      text-align: center;
      margin-bottom: 24px;
      border-bottom: 2px solid #333;
      padding-bottom: 12px;
    }
    .page-header h1 { font-size: 20px; font-weight: 700; }
    .page-header p { font-size: 11px; color: #666; margin-top: 4px; }
    .summary { text-align: center; font-size: 14px; font-weight: 700; margin-bottom: 16px; }
    .chart-section {
      page-break-inside: avoid;
      margin-bottom: 28px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    .chart-wrapper { display: flex; justify-content: center; overflow-x: auto; }
    .legend {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      justify-content: center;
      font-size: 11px;
      margin-top: 8px;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
    .group-section { margin-bottom: 24px; page-break-inside: avoid; }
    .group-header {
      font-size: 14px;
      font-weight: 700;
      background: #1a1a1a;
      color: #fff;
      padding: 6px 12px;
      margin-bottom: 8px;
    }
    .group-header .count { font-weight: 400; font-size: 12px; margin-inline-start: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: start; padding: 5px 8px; font-weight: 700; border-bottom: 2px solid #333; background: #f5f5f5; }
    td { padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr { page-break-inside: avoid; }
    .date-col { width: 14%; }
    .type-col { width: 16%; }
    .soldier-col { width: 22%; }
    .date-cell { white-space: nowrap; color: #4b5563; }
    .soldier-name { font-weight: 600; }
    .squad-meta { font-size: 10px; color: #6b7280; margin-top: 2px; }
    .subtype { font-size: 10px; color: #4b5563; margin-top: 2px; }
    .description { white-space: pre-wrap; }
    .response { font-size: 10px; color: #555; margin-top: 4px; white-space: pre-wrap; }
    .response-label { font-weight: 600; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .no-incidents { text-align: center; color: #9ca3af; font-style: italic; padding: 12px 8px; }
    .no-data { text-align: center; color: #9ca3af; font-style: italic; padding: 24px; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>דוח אירועים — ${escapeHtml(data.cycleName)}</h1>
    <p>תאריך הפקה: ${printDate}</p>
  </div>
  <div class="summary">סה״כ אירועים: ${totalCount}</div>
  <div class="chart-section">
    <div class="chart-wrapper">${chartSvg}</div>
    <div class="legend">${legendHtml}</div>
  </div>
  ${groupsHtml}
</body>
</html>`;
}
