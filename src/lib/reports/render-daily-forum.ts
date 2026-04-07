import { prisma } from "@/lib/db/prisma";
import type { ScoreConfig } from "@/types/score-config";
import { getActiveScores } from "@/types/score-config";
import { formatGradeDisplay } from "@/lib/score-format";
import type { ActivitySummaryRow } from "@/lib/reports/render-activity-summary";
import { parseMedicalAppointments, formatAppointment } from "@/lib/requests/medical-appointments";
import type { MedicalAppointment } from "@/lib/requests/medical-appointments";
import {
  escapeHtml,
  renderPieSvg,
  formatDateTime,
  formatDate,
  TYPE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/reports/html-helpers";
import {
  extractRequestFields,
  renderDetailColumnsHtml,
  DETAIL_COLUMNS_CSS,
} from "@/lib/reports/detail-columns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenRequestItem {
  id: string;
  type: string;
  typeLabel: string;
  status: string;
  assignedRole: string | null;
  soldierName: string;
  squad: string;
  description: string | null;
  createdAt: string;
  // Leave fields
  place: string | null;
  departureAt: string | null;
  returnAt: string | null;
  transportation: string | null;
  // Medical fields
  paramedicDate: string | null;
  medicalAppointments: MedicalAppointment[] | null;
  sickLeaveDays: number | null;
  // Hardship fields
  specialConditions: boolean | null;
  // Latest note
  latestNote: string | null;
}

export interface TodayActivityItem {
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
}

export interface TomorrowActivityItem {
  id: string;
  name: string;
  activityTypeName: string;
  status: string;
  isRequired: boolean;
}

export interface GapSoldier {
  name: string;
  result: "failed" | "missing";
}

export interface GapActivityItem {
  id: string;
  name: string;
  activityTypeName: string;
  date: string;
  soldiers: GapSoldier[];
}

export interface PlatoonForumSection {
  platoonId: string;
  platoonName: string;
  companyName: string;
  openRequests: {
    medical: OpenRequestItem[];
    hardship: OpenRequestItem[];
    leave: OpenRequestItem[];
  };
  todayActivities: TodayActivityItem[];
  tomorrowActivities: TomorrowActivityItem[];
  gaps: GapActivityItem[];
}

export interface DailyForumData {
  cycleName: string;
  date: string;
  tomorrowDate: string;
  platoons: PlatoonForumSection[];
}

// ---------------------------------------------------------------------------
// Israel timezone helpers
// ---------------------------------------------------------------------------

export function getIsraelDates(dateStr?: string): { today: string; tomorrow: string } {
  if (dateStr) {
    const d = new Date(dateStr + "T12:00:00+03:00");
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return { today: dateStr, tomorrow: next.toISOString().split("T")[0] };
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = formatter.format(new Date());
  const tomorrow = new Date(todayStr + "T12:00:00+03:00");
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today: todayStr, tomorrow: tomorrow.toISOString().split("T")[0] };
}

// ---------------------------------------------------------------------------
// Score rollup helper (shared logic with activity-summary)
// ---------------------------------------------------------------------------

function roundAvg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((s, g) => s + g, 0) / nums.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

export async function fetchDailyForum(
  cycleId: string,
  platoonIds: string[],
  dateStr?: string,
): Promise<DailyForumData | null> {
  const { today, tomorrow } = getIsraelDates(dateStr);
  const todayStart = new Date(today + "T00:00:00.000Z");
  const todayEnd = new Date(today + "T23:59:59.999Z");
  const tomorrowStart = new Date(tomorrow + "T00:00:00.000Z");
  const tomorrowEnd = new Date(tomorrow + "T23:59:59.999Z");

  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  // Fetch platoons with squads and active soldiers
  const platoons = await prisma.platoon.findMany({
    where: { id: { in: platoonIds } },
    include: {
      company: { select: { name: true } },
      squads: {
        orderBy: { sortOrder: "asc" },
        include: {
          soldiers: {
            where: { cycleId, status: "active" },
            select: { id: true, givenName: true, familyName: true },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Build soldier lookup per platoon
  const platoonSoldierMap = new Map<string, Map<string, { name: string; squadName: string }>>();
  for (const platoon of platoons) {
    const soldierMap = new Map<string, { name: string; squadName: string }>();
    for (const squad of platoon.squads) {
      for (const soldier of squad.soldiers) {
        soldierMap.set(soldier.id, {
          name: `${soldier.familyName} ${soldier.givenName}`,
          squadName: squad.name,
        });
      }
    }
    platoonSoldierMap.set(platoon.id, soldierMap);
  }

  // ---------------------------------------------------------------------------
  // Open requests
  // ---------------------------------------------------------------------------
  const openRequests = await prisma.request.findMany({
    where: {
      cycleId,
      assignedRole: { not: null },
      soldier: {
        squad: { platoon: { id: { in: platoonIds } } },
      },
    },
    include: {
      soldier: {
        include: {
          squad: {
            include: { platoon: { select: { id: true } } },
          },
        },
      },
      actions: {
        where: { note: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { note: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Group requests by platoon and type
  const requestsByPlatoon = new Map<string, { medical: OpenRequestItem[]; hardship: OpenRequestItem[]; leave: OpenRequestItem[] }>();
  for (const r of openRequests) {
    const platoonId = r.soldier.squad.platoon.id;
    if (!requestsByPlatoon.has(platoonId)) {
      requestsByPlatoon.set(platoonId, { medical: [], hardship: [], leave: [] });
    }
    const item: OpenRequestItem = {
      id: r.id,
      type: r.type,
      typeLabel: TYPE_LABELS[r.type] ?? r.type,
      status: r.status,
      assignedRole: r.assignedRole,
      soldierName: `${r.soldier.familyName} ${r.soldier.givenName}`,
      squad: r.soldier.squad.name,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
      place: r.place,
      departureAt: r.departureAt?.toISOString() ?? null,
      returnAt: r.returnAt?.toISOString() ?? null,
      transportation: r.transportation,
      paramedicDate: r.paramedicDate?.toISOString().split("T")[0] ?? null,
      medicalAppointments: parseMedicalAppointments(r.medicalAppointments as string | null),
      sickLeaveDays: r.sickLeaveDays,
      specialConditions: r.specialConditions,
      latestNote: r.actions[0]?.note ?? null,
    };
    const group = requestsByPlatoon.get(platoonId)!;
    if (r.type === "medical") group.medical.push(item);
    else if (r.type === "hardship") group.hardship.push(item);
    else group.leave.push(item);
  }

  // ---------------------------------------------------------------------------
  // Today's activities (with reports + score rollup)
  // ---------------------------------------------------------------------------
  const todayActivities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      date: { gte: todayStart, lte: todayEnd },
      status: "active",
    },
    include: {
      activityType: { select: { name: true, scoreConfig: true } },
      reports: {
        include: {
          soldier: {
            select: {
              status: true,
              squad: {
                select: {
                  name: true,
                  platoon: {
                    select: { id: true, name: true, company: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  // Group today's activities by platoon and compute summaries
  const todayByPlatoon = new Map<string, TodayActivityItem[]>();
  for (const activity of todayActivities) {
    const platoonId = activity.platoonId;
    if (!todayByPlatoon.has(platoonId)) todayByPlatoon.set(platoonId, []);

    const at = activity.activityType;
    const activeScores = getActiveScores(at.scoreConfig as ScoreConfig | null);
    const scoreLabels = activeScores.map((s) => s.label);
    const scoreFormats = activeScores.map((s) => s.format);
    const scoreCount = activeScores.length;

    const activeReports = activity.reports.filter((r) => r.soldier.status === "active");
    const passedCount = activeReports.filter((r) => r.result === "passed").length;
    const failedCount = activeReports.filter((r) => r.result === "failed").length;
    const naCount = activeReports.filter((r) => r.result === "na").length;

    // Squad-level score averages
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

    // Build rollup rows
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
      const platoonNames = [...new Set(cs.map((r) => r.platoon))];
      for (const pn of platoonNames) {
        mergedRows.push(...cs.filter((r) => r.platoon === pn));
        const pd = platoonMap.get(`${company}|${pn}`);
        if (pd) {
          mergedRows.push({ company, platoon: pn, squad: "", averages: pd.grades.map((g) => roundAvg(g)), level: "platoon" });
        }
      }
      const cg = companyMap.get(company);
      if (cg) {
        mergedRows.push({ company, platoon: "", squad: "", averages: cg.map((g) => roundAvg(g)), level: "company" });
      }
    }

    todayByPlatoon.get(platoonId)!.push({
      id: activity.id,
      name: activity.name,
      activityTypeName: activity.activityType.name,
      date: activity.date.toISOString().split("T")[0],
      scoreLabels,
      scoreFormats,
      passedCount,
      failedCount,
      naCount,
      totalSoldiers: activeReports.length,
      rows: mergedRows,
    });
  }

  // ---------------------------------------------------------------------------
  // Tomorrow's activities (simple list)
  // ---------------------------------------------------------------------------
  const tomorrowActivities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      date: { gte: tomorrowStart, lte: tomorrowEnd },
    },
    include: {
      activityType: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });

  const tomorrowByPlatoon = new Map<string, TomorrowActivityItem[]>();
  for (const activity of tomorrowActivities) {
    if (!tomorrowByPlatoon.has(activity.platoonId)) tomorrowByPlatoon.set(activity.platoonId, []);
    tomorrowByPlatoon.get(activity.platoonId)!.push({
      id: activity.id,
      name: activity.name,
      activityTypeName: activity.activityType.name,
      status: activity.status,
      isRequired: activity.isRequired,
    });
  }

  // ---------------------------------------------------------------------------
  // Gaps: required + active activities with date < today
  // ---------------------------------------------------------------------------
  const gapActivities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      status: "active",
      isRequired: true,
      date: { lt: todayStart },
    },
    include: {
      activityType: { select: { name: true } },
      reports: {
        select: { soldierId: true, result: true },
      },
    },
    orderBy: { date: "desc" },
  });

  const gapsByPlatoon = new Map<string, GapActivityItem[]>();
  for (const activity of gapActivities) {
    const platoonId = activity.platoonId;
    const soldierMap = platoonSoldierMap.get(platoonId);
    if (!soldierMap) continue;

    const reportMap = new Map<string, string>();
    for (const report of activity.reports) {
      reportMap.set(report.soldierId, report.result);
    }

    const gapSoldiers: GapSoldier[] = [];
    for (const [soldierId, info] of soldierMap) {
      const result = reportMap.get(soldierId);
      if (!result) {
        gapSoldiers.push({ name: info.name, result: "missing" });
      } else if (result === "failed") {
        gapSoldiers.push({ name: info.name, result: "failed" });
      }
    }

    if (gapSoldiers.length > 0) {
      if (!gapsByPlatoon.has(platoonId)) gapsByPlatoon.set(platoonId, []);
      gapsByPlatoon.get(platoonId)!.push({
        id: activity.id,
        name: activity.name,
        activityTypeName: activity.activityType.name,
        date: activity.date.toISOString().split("T")[0],
        soldiers: gapSoldiers.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Assemble per-platoon sections
  // ---------------------------------------------------------------------------
  const platoonSections: PlatoonForumSection[] = platoons.map((platoon) => ({
    platoonId: platoon.id,
    platoonName: platoon.name,
    companyName: platoon.company.name,
    openRequests: requestsByPlatoon.get(platoon.id) ?? { medical: [], hardship: [], leave: [] },
    todayActivities: todayByPlatoon.get(platoon.id) ?? [],
    tomorrowActivities: tomorrowByPlatoon.get(platoon.id) ?? [],
    gaps: gapsByPlatoon.get(platoon.id) ?? [],
  }));

  return {
    cycleName: cycle.name,
    date: today,
    tomorrowDate: tomorrow,
    platoons: platoonSections,
  };
}

// ---------------------------------------------------------------------------
// HTML rendering helpers
// ---------------------------------------------------------------------------

const htmlFormatters = {
  text: escapeHtml,
  dateTime: formatDateTime,
  date: formatDate,
  appointment: formatAppointment,
  transportationLabels: TRANSPORTATION_LABELS,
};

function renderRequestDetailsHtml(req: OpenRequestItem): string {
  const { fields, appointments } = extractRequestFields(req, htmlFormatters);

  const notes: { label: string; value: string }[] = [];
  if (req.latestNote) {
    notes.push({ label: "הערה", value: escapeHtml(req.latestNote) });
  }

  return renderDetailColumnsHtml({ fields, appointments, notes });
}

function renderRequestTypeSection(title: string, requests: OpenRequestItem[]): string {
  if (requests.length === 0) return "";
  const cards = requests.map((req) => {
    const details = renderRequestDetailsHtml(req);
    return `
      <div class="request-card">
        <div class="request-header">
          <span class="soldier-name">${escapeHtml(req.soldierName)}</span>
          <span class="request-squad">${escapeHtml(req.squad)}</span>
          <span class="request-date">${formatDateTime(req.createdAt)}</span>
        </div>
        ${details ? `<div class="request-details">${details}</div>` : ""}
      </div>
    `;
  }).join("\n");

  return `
    <div class="type-group">
      <div class="type-header">${escapeHtml(title)} (${requests.length})</div>
      ${cards}
    </div>
  `;
}

function renderTodayActivitiesHtml(activities: TodayActivityItem[]): string {
  if (activities.length === 0) return '<p class="no-data">אין פעילויות להיום</p>';

  return activities.map((activity) => {
    const pieSvg = renderPieSvg(activity.passedCount, activity.failedCount, activity.naCount);
    const scoreHeaders = activity.scoreLabels.map((l) => `<th>${escapeHtml(l)}</th>`).join("");

    const tableRows = activity.rows.map((row) => {
      const cls = row.level === "company" ? ' class="row-company"' : row.level === "platoon" ? ' class="row-platoon"' : "";
      const avgCells = row.averages.map((a, ai) => `<td>${a != null ? formatGradeDisplay(a, activity.scoreFormats[ai]) : "—"}</td>`).join("");
      return `<tr${cls}><td>${escapeHtml(row.company)}</td><td>${escapeHtml(row.platoon)}</td><td>${escapeHtml(row.squad)}</td>${avgCells}</tr>`;
    }).join("\n");

    const dateStr = new Date(activity.date).toLocaleDateString("he-IL");

    return `
      <div class="activity-section">
        <div class="activity-header">
          ${escapeHtml(activity.activityTypeName)} — ${escapeHtml(activity.name)}
          <span class="activity-date"> (${dateStr})</span>
        </div>
        <div class="chart-row">
          ${pieSvg}
          <div>
            <div class="legend">
              <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span> עבר (${activity.passedCount})</span>
              <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> נכשל (${activity.failedCount})</span>
              <span class="legend-item"><span class="legend-dot" style="background:#9ca3af"></span> לא רלוונטי (${activity.naCount})</span>
            </div>
            <p class="total-line">סה״כ ${activity.totalSoldiers} חיילים</p>
          </div>
        </div>
        ${activity.rows.length > 0 ? `
        <table>
          <thead><tr><th>פלוגה</th><th>מחלקה</th><th>כיתה</th>${scoreHeaders}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ` : ""}
      </div>
    `;
  }).join("\n");
}

function renderTomorrowActivitiesHtml(activities: TomorrowActivityItem[]): string {
  if (activities.length === 0) return '<p class="no-data">אין פעילויות למחר</p>';

  const rows = activities.map((a) => {
    const statusBadge = a.status === "active"
      ? '<span class="badge badge-active">פעיל</span>'
      : '<span class="badge badge-draft">טיוטה</span>';
    const requiredBadge = a.isRequired
      ? '<span class="badge badge-required">חובה</span>'
      : '<span class="badge badge-optional">רשות</span>';
    return `<tr><td>${escapeHtml(a.activityTypeName)}</td><td>${escapeHtml(a.name)}</td><td>${statusBadge}</td><td>${requiredBadge}</td></tr>`;
  }).join("\n");

  return `
    <table class="tomorrow-table">
      <thead><tr><th>סוג</th><th>שם</th><th>סטטוס</th><th>חובה</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderGapsHtml(gaps: GapActivityItem[]): string {
  if (gaps.length === 0) return '<p class="no-data">אין פערים</p>';

  return gaps.map((gap) => {
    const dateStr = new Date(gap.date).toLocaleDateString("he-IL");
    const soldierRows = gap.soldiers.map((s) => {
      const badge = s.result === "failed"
        ? '<span class="badge badge-failed">נכשל</span>'
        : '<span class="badge badge-missing">חסר</span>';
      return `<tr><td>${escapeHtml(s.name)}</td><td>${badge}</td></tr>`;
    }).join("\n");

    return `
      <div class="gap-section">
        <div class="gap-header">
          ${escapeHtml(gap.activityTypeName)} — ${escapeHtml(gap.name)}
          <span class="gap-date">(${dateStr})</span>
          <span class="gap-count">${gap.soldiers.length} פערים</span>
        </div>
        <table class="gap-table">
          <thead><tr><th>חייל</th><th>סטטוס</th></tr></thead>
          <tbody>${soldierRows}</tbody>
        </table>
      </div>
    `;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Main HTML renderer
// ---------------------------------------------------------------------------

export function renderDailyForumHtml(data: DailyForumData): string {
  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric", month: "long", year: "numeric",
  });

  const dateDisplay = new Date(data.date + "T12:00:00").toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const tomorrowDisplay = new Date(data.tomorrowDate + "T12:00:00").toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const multiPlatoon = data.platoons.length > 1;

  const platoonsHtml = data.platoons.map((platoon, i) => {
    const pageBreak = multiPlatoon && i > 0 ? ' style="page-break-before: always;"' : "";
    const totalRequests = platoon.openRequests.medical.length + platoon.openRequests.hardship.length + platoon.openRequests.leave.length;

    const requestsHtml = totalRequests > 0
      ? [
          renderRequestTypeSection("רפואה", platoon.openRequests.medical),
          renderRequestTypeSection('ת"ש', platoon.openRequests.hardship),
          renderRequestTypeSection("יציאה", platoon.openRequests.leave),
        ].join("\n")
      : '<p class="no-data">אין בקשות פתוחות</p>';

    return `
      <div class="platoon-section"${pageBreak}>
        ${multiPlatoon ? `<div class="platoon-header">${escapeHtml(platoon.companyName)} — ${escapeHtml(platoon.platoonName)}</div>` : ""}

        <div class="section-block">
          <h2 class="section-title">בקשות פתוחות (${totalRequests})</h2>
          ${requestsHtml}
        </div>

        <div class="group-block">
          <h2 class="group-title">הספקים</h2>
          <div class="section-block">
            <h3 class="section-title">פעילויות היום — ${escapeHtml(dateDisplay)}</h3>
            ${renderTodayActivitiesHtml(platoon.todayActivities)}
          </div>

          <div class="section-block">
            <h3 class="section-title">פעילויות מחר — ${escapeHtml(tomorrowDisplay)}</h3>
            ${renderTomorrowActivitiesHtml(platoon.tomorrowActivities)}
          </div>
        </div>

        <div class="group-block">
          <h2 class="group-title">תכנון מול ביצוע</h2>
          <div class="section-block">
            <h3 class="section-title">פערים</h3>
            ${renderGapsHtml(platoon.gaps)}
          </div>
        </div>
      </div>
    `;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>דוח פורום יומי — ${escapeHtml(data.cycleName)}</title>
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
    .platoon-header {
      font-size: 16px;
      font-weight: 700;
      background: #1a1a1a;
      color: #fff;
      padding: 8px 12px;
      margin-bottom: 16px;
    }
    .platoon-section { margin-bottom: 32px; }
    .group-block { margin-bottom: 28px; }
    .group-title {
      font-size: 15px;
      font-weight: 700;
      background: #f0f0f0;
      padding: 6px 10px;
      margin-bottom: 12px;
      border-right: 4px solid #333;
    }
    .section-block { margin-bottom: 20px; }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      border-bottom: 1px solid #999;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }
    /* Requests */
    .type-group { margin-bottom: 12px; }
    .type-header {
      font-size: 11px;
      font-weight: 600;
      background: #f0f0f0;
      padding: 3px 8px;
      margin-bottom: 4px;
    }
    .request-card {
      border-bottom: 1px solid #ddd;
      padding: 5px 8px;
    }
    .request-header {
      display: flex;
      gap: 10px;
      align-items: baseline;
    }
    .soldier-name { font-weight: 600; font-size: 11px; }
    .request-squad { font-size: 10px; color: #666; }
    .request-date { font-size: 10px; color: #666; }
    .request-details {
      font-size: 10px;
      color: #444;
      margin-top: 2px;
      padding-right: 4px;
    }
${DETAIL_COLUMNS_CSS}
    /* Activities */
    .activity-section {
      page-break-inside: avoid;
      margin-bottom: 20px;
    }
    .activity-header {
      font-size: 13px;
      font-weight: 700;
      border-bottom: 1px solid #ccc;
      padding-bottom: 4px;
      margin-bottom: 8px;
    }
    .activity-date { font-size: 10px; color: #666; font-weight: 400; }
    .chart-row { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
    .legend { font-size: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .total-line { font-size: 10px; color: #666; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
    th { text-align: start; padding: 5px 6px; font-weight: 700; border-bottom: 2px solid #333; background: #f5f5f5; }
    td { padding: 4px 6px; border-bottom: 1px solid #ddd; }
    .row-platoon { background: #f0f0f0; font-weight: 600; }
    .row-company { background: #e0e0e0; font-weight: 700; }
    /* Tomorrow table */
    .tomorrow-table { margin-top: 4px; }
    /* Badges */
    .badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .badge-active { background: #dcfce7; color: #166534; }
    .badge-draft { background: #fef3c7; color: #92400e; }
    .badge-required { background: #dbeafe; color: #1e40af; }
    .badge-optional { background: #f3f4f6; color: #6b7280; }
    .badge-failed { background: #fee2e2; color: #991b1b; }
    .badge-missing { background: #fef3c7; color: #92400e; }
    /* Gaps */
    .gap-section {
      page-break-inside: avoid;
      margin-bottom: 12px;
    }
    .gap-header {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .gap-date { font-size: 10px; color: #666; font-weight: 400; }
    .gap-count { font-size: 10px; color: #ef4444; font-weight: 600; margin-right: 8px; }
    .gap-table { width: auto; min-width: 200px; }
    .no-data { font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>דוח פורום יומי — ${escapeHtml(data.cycleName)}</h1>
    <p>${dateDisplay} · תאריך הפקה: ${printDate}</p>
  </div>
  ${platoonsHtml}
</body>
</html>`;
}
