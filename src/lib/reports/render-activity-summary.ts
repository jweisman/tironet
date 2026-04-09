import { prisma } from "@/lib/db/prisma";
import type { ScoreConfig } from "@/types/score-config";
import { getActiveScores } from "@/types/score-config";
import type { DisplayConfiguration } from "@/types/display-config";
import { getResultLabels } from "@/types/display-config";
import { formatGradeDisplay } from "@/lib/score-format";
import { renderPieSvg } from "@/lib/reports/html-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivitySummaryRow {
  company: string;
  platoon: string;
  squad: string;
  averages: (number | null)[];
  level: "squad" | "platoon" | "company";
}

export interface ActivitySummaryItem {
  id: string;
  name: string;
  activityTypeName: string;
  date: string;
  scoreLabels: string[];
  scoreFormats: ("number" | "time")[];
  passedCount: number;
  failedCount: number;
  naCount: number;
  totalSoldiers: number;
  rows: ActivitySummaryRow[];
  displayConfiguration?: DisplayConfiguration | null;
}

export interface ActivitySummaryData {
  cycleName: string;
  activities: ActivitySummaryItem[];
}

function roundAvg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((s, g) => s + g, 0) / nums.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

export async function fetchActivitySummary(cycleId: string, platoonIds: string[], activityTypeIds?: string[], afterDate?: Date) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  const activities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      status: "active",
      ...(activityTypeIds && activityTypeIds.length > 0 ? { activityTypeId: { in: activityTypeIds } } : {}),
      ...(afterDate ? { date: { gte: afterDate } } : {}),
    },
    include: {
      activityType: { select: { name: true, scoreConfig: true, displayConfiguration: true } },
      reports: {
        include: {
          soldier: {
            select: {
              status: true,
              squad: {
                select: {
                  name: true,
                  platoon: {
                    select: { name: true, company: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { date: "desc" },
  });

  const result: ActivitySummaryItem[] = activities.map((activity) => {
    const at = activity.activityType;
    const activeScores = getActiveScores(at.scoreConfig as ScoreConfig | null);
    const scoreLabels = activeScores.map((s) => s.label);
    const scoreFormats = activeScores.map((s) => s.format);
    const scoreCount = activeScores.length;

    const activeReports = activity.reports.filter((r) => r.soldier.status === "active");
    const passedCount = activeReports.filter((r) => r.result === "passed").length;
    const failedCount = activeReports.filter((r) => r.result === "failed").length;
    const naCount = activeReports.filter((r) => r.result === "na").length;

    // grades[scoreIndex][] per squad key
    const squadMap = new Map<string, { company: string; platoon: string; squad: string; grades: number[][] }>();
    for (const report of activeReports) {
      const sq = report.soldier.squad;
      const key = `${sq.platoon.company.name}|${sq.platoon.name}|${sq.name}`;
      if (!squadMap.has(key)) {
        squadMap.set(key, {
          company: sq.platoon.company.name,
          platoon: sq.platoon.name,
          squad: sq.name,
          grades: Array.from({ length: scoreCount }, () => []),
        });
      }
      const entry = squadMap.get(key)!;
      for (let i = 0; i < scoreCount; i++) {
        const gradeField = activeScores[i].gradeKey;
        const val = report[gradeField];
        if (val != null) entry.grades[i].push(Number(val));
      }
    }

    const rows: ActivitySummaryRow[] = [];
    const platoonMap = new Map<string, { company: string; grades: number[][] }>();
    const companyMap = new Map<string, number[][]>();
    const sortedSquads = [...squadMap.values()].sort((a, b) =>
      `${a.company}|${a.platoon}|${a.squad}`.localeCompare(`${b.company}|${b.platoon}|${b.squad}`)
    );

    for (const entry of sortedSquads) {
      const averages = entry.grades.map((g) => roundAvg(g));
      rows.push({ company: entry.company, platoon: entry.platoon, squad: entry.squad, averages, level: "squad" });

      const pk = `${entry.company}|${entry.platoon}`;
      if (!platoonMap.has(pk)) {
        platoonMap.set(pk, { company: entry.company, grades: Array.from({ length: scoreCount }, () => []) });
      }
      const pm = platoonMap.get(pk)!;
      for (let i = 0; i < scoreCount; i++) pm.grades[i].push(...entry.grades[i]);

      if (!companyMap.has(entry.company)) {
        companyMap.set(entry.company, Array.from({ length: scoreCount }, () => []));
      }
      const cm = companyMap.get(entry.company)!;
      for (let i = 0; i < scoreCount; i++) cm[i].push(...entry.grades[i]);
    }

    const mergedRows: ActivitySummaryRow[] = [];
    const companies = [...new Set(sortedSquads.map((s) => s.company))];
    for (const company of companies) {
      const cs = rows.filter((r) => r.company === company);
      const platoons = [...new Set(cs.map((r) => r.platoon))];
      for (const platoon of platoons) {
        mergedRows.push(...cs.filter((r) => r.platoon === platoon));
        const pd = platoonMap.get(`${company}|${platoon}`);
        if (pd) {
          mergedRows.push({ company, platoon, squad: "", averages: pd.grades.map((g) => roundAvg(g)), level: "platoon" });
        }
      }
      const cg = companyMap.get(company);
      if (cg) {
        mergedRows.push({ company, platoon: "", squad: "", averages: cg.map((g) => roundAvg(g)), level: "company" });
      }
    }

    return {
      id: activity.id,
      name: activity.name,
      activityTypeName: activity.activityType.name,
      date: activity.date.toISOString().split("T")[0],
      scoreLabels,
      scoreFormats,
      passedCount, failedCount, naCount,
      totalSoldiers: activeReports.length,
      rows: mergedRows,
      displayConfiguration: at.displayConfiguration as DisplayConfiguration | null,
    };
  });

  return { cycleName: cycle.name, activities: result };
}


// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

export function renderActivitySummaryHtml(
  data: { cycleName: string; activities: ActivitySummaryItem[] }
): string {
  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric", month: "long", year: "numeric",
  });

  const activitiesHtml = data.activities.map((activity) => {
    const pieSvg = renderPieSvg(activity.passedCount, activity.failedCount, activity.naCount);
    const labels = activity.scoreLabels;

    const scoreHeaders = labels.map((l) => `<th>${l}</th>`).join("");

    const tableRows = activity.rows.map((row) => {
      const cls = row.level === "company" ? ' class="row-company"' : row.level === "platoon" ? ' class="row-platoon"' : "";
      const avgCells = row.averages.map((a, ai) => `<td>${a != null ? formatGradeDisplay(a, activity.scoreFormats[ai]) : "—"}</td>`).join("");
      return `<tr${cls}><td>${row.company}</td><td>${row.platoon}</td><td>${row.squad}</td>${avgCells}</tr>`;
    }).join("\n");

    const dateStr = new Date(activity.date).toLocaleDateString("he-IL");

    return `
      <div class="activity-section">
        <div class="activity-header">
          ${activity.activityTypeName} — ${activity.name}
          <span class="activity-date"> (${dateStr})</span>
        </div>
        <div class="chart-row">
          ${pieSvg}
          <div>
            <div class="legend">
              <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span> ${getResultLabels(activity.displayConfiguration).passed.label} (${activity.passedCount})</span>
              <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> ${getResultLabels(activity.displayConfiguration).failed.label} (${activity.failedCount})</span>
              <span class="legend-item"><span class="legend-dot" style="background:#9ca3af"></span> ${getResultLabels(activity.displayConfiguration).na.label} (${activity.naCount})</span>
            </div>
            <p class="total-line">סה״כ ${activity.totalSoldiers} חיילים</p>
          </div>
        </div>
        ${activity.rows.length > 0 ? `
        <table>
          <thead><tr><th>פלוגה</th><th>מחלקה</th><th>כיתה</th>${scoreHeaders}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ` : '<p class="no-data">אין נתונים</p>'}
      </div>
    `;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>סיכום פעילויות — ${data.cycleName}</title>
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
    .activity-section {
      page-break-inside: avoid;
      margin-bottom: 28px;
    }
    .activity-header {
      font-size: 14px;
      font-weight: 700;
      border-bottom: 1px solid #ccc;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .activity-date { font-size: 10px; color: #666; font-weight: 400; }
    .chart-row { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
    .legend { font-size: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: start; padding: 6px 8px; font-weight: 700; border-bottom: 2px solid #333; background: #f5f5f5; }
    td { padding: 5px 8px; border-bottom: 1px solid #ddd; }
    .row-platoon { background: #f0f0f0; font-weight: 600; }
    .row-company { background: #e0e0e0; font-weight: 700; }
    .total-line { font-size: 10px; color: #666; margin-top: 4px; }
    .no-data { font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>סיכום פעילויות — ${data.cycleName}</h1>
    <p>תאריך הפקה: ${printDate}</p>
  </div>
  ${activitiesHtml}
</body>
</html>`;
}
