import { prisma } from "@/lib/db/prisma";
import type { ScoreConfig } from "@/types/score-config";
import { getActiveScores } from "@/types/score-config";
import type { DisplayConfiguration } from "@/types/display-config";
import { getResultLabels } from "@/types/display-config";
import { formatGradeDisplay } from "@/lib/score-format";
import type { ActivitySummaryRow } from "@/lib/reports/render-activity-summary";
import { parseMedicalAppointments, formatAppointment } from "@/lib/requests/medical-appointments";
import type { MedicalAppointment } from "@/lib/requests/medical-appointments";
import { parseSickDays, formatSickDay } from "@/lib/requests/sick-days";
import { INCIDENT_TYPE_LABELS, getSubtypeLabel } from "@/lib/incidents/constants";
import type { SickDay } from "@/lib/requests/sick-days";
import { isRequestActive } from "@/lib/requests/active";
import { fetchAttendance, STATUS_LABELS as ATTENDANCE_STATUS_LABELS } from "@/lib/reports/render-attendance";
import {
  escapeHtml,
  renderPieSvg,
  PIE_COLORS,
  formatDateTime,
  formatDate,
  TYPE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/reports/html-helpers";
import {
  extractRequestFields,
  formatNotes,
  renderDetailColumnsHtml,
  DETAIL_COLUMNS_CSS,
} from "@/lib/reports/detail-columns";
import { hebrewCount } from "@/lib/utils/hebrew-count";

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
  sickDays: SickDay[] | null;
  // Hardship fields
  specialConditions: boolean | null;
  // Audit trail notes
  notes: { action: string; userName: string; note: string }[];
}

export interface TodayActivityItem {
  id: string;
  name: string;
  activityTypeName: string;
  date: string;
  scoreLabels: string[];
  scoreFormats: ("number" | "time")[];
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  naCount: number;
  missingCount: number;
  totalSoldiers: number;
  rows: ActivitySummaryRow[];
  displayConfiguration?: DisplayConfiguration | null;
}

export interface TomorrowActivityItem {
  id: string;
  name: string;
  activityTypeName: string;
  isRequired: boolean;
}

export interface GapSoldier {
  name: string;
  result: "skipped" | "failed" | "missing";
}

export interface GapActivityItem {
  id: string;
  name: string;
  activityTypeName: string;
  date: string;
  soldiers: GapSoldier[];
  displayConfiguration?: DisplayConfiguration | null;
}

export interface CommanderEventItem {
  id: string;
  userName: string;
  type: string;
  description: string | null;
  startDate: string;
  endDate: string;
}

export interface IncidentItem {
  id: string;
  soldierName: string;
  type: string;
  subtype: string | null;
  description: string;
  response: string | null;
}

const CMDR_EVENT_TYPE_LABELS: Record<string, string> = {
  leave: "יציאה",
  medical: "רפואה",
};


export interface PlatoonForumSection {
  platoonId: string;
  platoonName: string;
  companyName: string;
  openRequests: {
    medical: OpenRequestItem[];
    hardship: OpenRequestItem[];
    leave: OpenRequestItem[];
  };
  activeRequests: {
    medical: OpenRequestItem[];
    leave: OpenRequestItem[];
  };
  commanderEvents: CommanderEventItem[];
  incidents: IncidentItem[];
  todayActivities: TodayActivityItem[];
  tomorrowActivities: TomorrowActivityItem[];
  gaps: GapActivityItem[];
}

export interface AttendanceSummaryPlatoon {
  platoonName: string;
  presentCount: number;
  totalCount: number;
  absent: { name: string; squad: string; status: string; reason: string | null }[];
}

export interface DailyForumData {
  cycleName: string;
  date: string;
  tomorrowDate: string;
  platoons: PlatoonForumSection[];
  attendance: AttendanceSummaryPlatoon[];
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
      status: "open",
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
        orderBy: { createdAt: "asc" },
        select: { action: true, userName: true, note: true },
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
      sickDays: parseSickDays(r.sickDays as string | null),
      specialConditions: r.specialConditions,
      notes: (r.actions ?? [])
        .filter((a): a is typeof a & { note: string } => a.note != null)
        .map((a) => ({ action: a.action, userName: a.userName, note: a.note })),
    };
    const group = requestsByPlatoon.get(platoonId)!;
    if (r.type === "medical") group.medical.push(item);
    else if (r.type === "hardship") group.hardship.push(item);
    else group.leave.push(item);
  }

  // ---------------------------------------------------------------------------
  // Active requests (approved leave with future dates, medical with future appointments — no hardship)
  // ---------------------------------------------------------------------------
  const activeRequests = await prisma.request.findMany({
    where: {
      cycleId,
      status: "approved",
      type: { in: ["leave", "medical"] },
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
        orderBy: { createdAt: "asc" },
        select: { action: true, userName: true, note: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Filter to actually active and group by platoon
  const activeByPlatoon = new Map<string, { medical: OpenRequestItem[]; leave: OpenRequestItem[] }>();
  for (const r of activeRequests) {
    const platoonId = r.soldier.squad.platoon.id;
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
      sickDays: parseSickDays(r.sickDays as string | null),
      specialConditions: r.specialConditions,
      notes: (r.actions ?? [])
        .filter((a): a is typeof a & { note: string } => a.note != null)
        .map((a) => ({ action: a.action, userName: a.userName, note: a.note })),
    };

    // Check if actually active (future dates)
    if (!isRequestActive({
      status: r.status,
      type: r.type,
      departureAt: r.departureAt?.toISOString(),
      returnAt: r.returnAt?.toISOString(),
      medicalAppointments: item.medicalAppointments,
      sickDays: item.sickDays,
    }, today)) continue;

    if (!activeByPlatoon.has(platoonId)) {
      activeByPlatoon.set(platoonId, { medical: [], leave: [] });
    }
    const group = activeByPlatoon.get(platoonId)!;
    if (r.type === "medical") group.medical.push(item);
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

  // Count active soldiers per platoon (for missing report calculation)
  const soldierCountsByPlatoon = new Map<string, number>();
  {
    const counts = await prisma.soldier.groupBy({
      by: ["squadId"],
      where: { cycleId, status: "active", squad: { platoonId: { in: platoonIds } } },
      _count: true,
    });
    // Map squad→platoon
    const squadPlatoonMap = new Map<string, string>();
    for (const activity of todayActivities) {
      for (const report of activity.reports) {
        const sq = report.soldier.squad;
        if ("platoon" in sq && sq.platoon) {
          squadPlatoonMap.set(sq.name, activity.platoonId);
        }
      }
    }
    // Simpler: query squads directly
    const squads = await prisma.squad.findMany({
      where: { platoonId: { in: platoonIds } },
      select: { id: true, platoonId: true },
    });
    const sqToPlatoon = new Map(squads.map((s) => [s.id, s.platoonId]));
    for (const c of counts) {
      const pId = sqToPlatoon.get(c.squadId);
      if (pId) soldierCountsByPlatoon.set(pId, (soldierCountsByPlatoon.get(pId) ?? 0) + c._count);
    }
  }

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
    const completedCount = activeReports.filter((r) => r.result === "completed" && !r.failed).length;
    const skippedCount = activeReports.filter((r) => r.result === "skipped").length;
    const failedCount = activeReports.filter((r) => r.result === "completed" && r.failed).length;
    const naCount = activeReports.filter((r) => r.result === "na").length;
    const totalActiveSoldiers = soldierCountsByPlatoon.get(activity.platoonId) ?? activeReports.length;
    const missingCount = Math.max(0, totalActiveSoldiers - activeReports.length);

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
      completedCount,
      skippedCount,
      failedCount,
      naCount,
      missingCount,
      totalSoldiers: totalActiveSoldiers,
      rows: mergedRows,
      displayConfiguration: activity.activityType.displayConfiguration as DisplayConfiguration | null,
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
      isRequired: true,
      date: { lt: todayStart },
    },
    include: {
      activityType: { select: { name: true, displayConfiguration: true } },
      reports: {
        select: { soldierId: true, result: true, failed: true },
      },
    },
    orderBy: { date: "desc" },
  });

  const gapsByPlatoon = new Map<string, GapActivityItem[]>();
  for (const activity of gapActivities) {
    const platoonId = activity.platoonId;
    const soldierMap = platoonSoldierMap.get(platoonId);
    if (!soldierMap) continue;

    const reportMap = new Map<string, { result: string; failed: boolean }>();
    for (const report of activity.reports) {
      reportMap.set(report.soldierId, { result: report.result, failed: report.failed });
    }

    const gapSoldiers: GapSoldier[] = [];
    for (const [soldierId, info] of soldierMap) {
      const report = reportMap.get(soldierId);
      if (!report) {
        gapSoldiers.push({ name: info.name, result: "missing" });
      } else if (report.result === "skipped") {
        gapSoldiers.push({ name: info.name, result: "skipped" });
      } else if (report.failed) {
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
        displayConfiguration: activity.activityType.displayConfiguration as DisplayConfiguration | null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Commander events active on the report date
  // ---------------------------------------------------------------------------
  const cmdrEvents = await prisma.commanderEvent.findMany({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      startDate: { lte: new Date(today + "T23:59:59.999Z") },
      endDate: { gte: new Date(today + "T00:00:00.000Z") },
    },
    select: {
      id: true,
      userName: true,
      type: true,
      description: true,
      startDate: true,
      endDate: true,
      platoonId: true,
    },
    orderBy: { startDate: "asc" },
  });

  const cmdrByPlatoon = new Map<string, CommanderEventItem[]>();
  for (const ev of cmdrEvents) {
    if (!cmdrByPlatoon.has(ev.platoonId)) cmdrByPlatoon.set(ev.platoonId, []);
    cmdrByPlatoon.get(ev.platoonId)!.push({
      id: ev.id,
      userName: ev.userName,
      type: ev.type,
      description: ev.description,
      startDate: ev.startDate.toISOString().split("T")[0],
      endDate: ev.endDate.toISOString().split("T")[0],
    });
  }

  // ---------------------------------------------------------------------------
  // Incidents on the report date
  // ---------------------------------------------------------------------------
  const incidentsRaw = await prisma.incident.findMany({
    where: {
      soldier: {
        squad: { platoonId: { in: platoonIds } },
        cycleId,
      },
      date: new Date(today + "T00:00:00.000Z"),
    },
    select: {
      id: true,
      type: true,
      subtype: true,
      description: true,
      response: true,
      soldier: {
        select: {
          familyName: true,
          givenName: true,
          squad: { select: { platoonId: true } },
        },
      },
    },
  });

  const incidentsByPlatoon = new Map<string, IncidentItem[]>();
  for (const inc of incidentsRaw) {
    const pId = inc.soldier.squad.platoonId;
    if (!incidentsByPlatoon.has(pId)) incidentsByPlatoon.set(pId, []);
    incidentsByPlatoon.get(pId)!.push({
      id: inc.id,
      soldierName: `${inc.soldier.familyName} ${inc.soldier.givenName}`,
      type: inc.type,
      subtype: inc.subtype,
      description: inc.description,
      response: inc.response,
    });
  }

  // ---------------------------------------------------------------------------
  // Assemble per-platoon sections
  // ---------------------------------------------------------------------------
  const platoonSections: PlatoonForumSection[] = platoons.map((platoon) => ({
    platoonId: platoon.id,
    platoonName: platoon.name,
    companyName: platoon.company.name,
    openRequests: requestsByPlatoon.get(platoon.id) ?? { medical: [], hardship: [], leave: [] },
    activeRequests: activeByPlatoon.get(platoon.id) ?? { medical: [], leave: [] },
    commanderEvents: cmdrByPlatoon.get(platoon.id) ?? [],
    incidents: incidentsByPlatoon.get(platoon.id) ?? [],
    todayActivities: todayByPlatoon.get(platoon.id) ?? [],
    tomorrowActivities: tomorrowByPlatoon.get(platoon.id) ?? [],
    gaps: gapsByPlatoon.get(platoon.id) ?? [],
  }));

  // Fetch attendance summary (absent soldiers only for forum)
  const attendanceData = await fetchAttendance(cycleId, platoonIds, today);
  const attendance: AttendanceSummaryPlatoon[] = (attendanceData?.platoons ?? []).map((p) => ({
    platoonName: p.platoonName,
    presentCount: p.presentCount,
    totalCount: p.totalCount,
    absent: p.squads
      .flatMap((sq) => sq.soldiers.filter((s) => s.status !== "present").map((s) => ({
        name: s.name,
        squad: sq.name,
        status: s.status,
        reason: s.reason,
      }))),
  }));

  return {
    cycleName: cycle.name,
    date: today,
    tomorrowDate: tomorrow,
    platoons: platoonSections,
    attendance,
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
  sickDay: formatSickDay,
  transportationLabels: TRANSPORTATION_LABELS,
};

function renderRequestDetailsHtml(req: OpenRequestItem, options?: { highlightDates?: boolean }): string {
  const { fields, appointments, sickDays } = extractRequestFields(req, htmlFormatters, options);

  const notes = formatNotes(req.notes, escapeHtml);

  return renderDetailColumnsHtml({ fields, appointments, sickDays, notes });
}

const STATUS_LABELS: Record<string, string> = { open: "ממתינה", approved: "אושר", denied: "נדחה" };
const ROLE_LABELS: Record<string, string> = {
  squad_commander: 'מ"כ', platoon_commander: 'מ"מ', platoon_sergeant: 'סמ"ח',
  company_commander: 'מ"פ', deputy_company_commander: 'סמ"פ', instructor: "מדריך", company_medic: 'חופ"ל', hardship_coordinator: 'מש"קית ת"ש',
};

function renderRequestCards(requests: OpenRequestItem[], options?: { highlightDates?: boolean }): string {
  return requests.map((req) => {
    const details = renderRequestDetailsHtml(req, options);
    const statusBadge = `<span class="badge badge-status">${escapeHtml(STATUS_LABELS[req.status] ?? req.status)}</span>`;
    const roleBadge = req.assignedRole
      ? `<span class="badge badge-role">ממתין ל${escapeHtml(ROLE_LABELS[req.assignedRole] ?? req.assignedRole)}</span>`
      : "";
    return `
      <div class="request-card">
        <div class="request-header">
          <span class="soldier-name">${escapeHtml(req.soldierName)}</span>
          <span class="request-squad">${escapeHtml(req.squad)}</span>
          <span class="request-date">${formatDateTime(req.createdAt)}</span>
          <span class="request-badges">${statusBadge}${roleBadge}</span>
        </div>
        ${details ? `<div class="request-details">${details}</div>` : ""}
      </div>
    `;
  }).join("\n");
}

function renderTodayActivitiesHtml(activities: TodayActivityItem[]): string {
  if (activities.length === 0) return '<p class="no-data">אין פעילויות להיום</p>';

  return activities.map((activity) => {
    const pieData = { completed: activity.completedCount, skipped: activity.skippedCount, failed: activity.failedCount, na: activity.naCount, missing: activity.missingCount };
    const pieSvg = renderPieSvg(pieData);
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
              <span class="legend-item"><span class="legend-dot" style="background:${PIE_COLORS.completed}"></span> ${getResultLabels(activity.displayConfiguration).completed.label} (${activity.completedCount})</span>
              ${activity.skippedCount > 0 ? `<span class="legend-item"><span class="legend-dot" style="background:${PIE_COLORS.skipped}"></span> ${getResultLabels(activity.displayConfiguration).skipped.label} (${activity.skippedCount})</span>` : ""}
              ${activity.failedCount > 0 ? `<span class="legend-item"><span class="legend-dot" style="background:${PIE_COLORS.failed}"></span> נכשל (${activity.failedCount})</span>` : ""}
              ${activity.naCount > 0 ? `<span class="legend-item"><span class="legend-dot" style="background:${PIE_COLORS.na}"></span> ${getResultLabels(activity.displayConfiguration).na.label} (${activity.naCount})</span>` : ""}
              ${activity.missingCount > 0 ? `<span class="legend-item"><span class="legend-dot" style="background:${PIE_COLORS.missing}"></span> ללא דיווח (${activity.missingCount})</span>` : ""}
            </div>
            <p class="total-line">סה״כ ${hebrewCount(activity.totalSoldiers, "חייל", "חיילים")}</p>
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
    const requiredBadge = a.isRequired
      ? '<span class="badge badge-required">חובה</span>'
      : '<span class="badge badge-optional">רשות</span>';
    return `<tr><td>${escapeHtml(a.activityTypeName)}</td><td>${escapeHtml(a.name)}</td><td>${requiredBadge}</td></tr>`;
  }).join("\n");

  return `
    <table class="tomorrow-table">
      <thead><tr><th>סוג</th><th>שם</th><th>חובה</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderGapsHtml(gaps: GapActivityItem[]): string {
  if (gaps.length === 0) return '<p class="no-data">אין פערים</p>';

  return gaps.map((gap) => {
    const dateStr = new Date(gap.date).toLocaleDateString("he-IL");
    const resultLabels = getResultLabels(gap.displayConfiguration);
    const soldierRows = gap.soldiers.map((s) => {
      let badge: string;
      if (s.result === "skipped") {
        badge = `<span class="badge badge-failed">${resultLabels.skipped.label}</span>`;
      } else if (s.result === "failed") {
        badge = '<span class="badge badge-failed">נכשל</span>';
      } else {
        badge = '<span class="badge badge-missing">חסר</span>';
      }
      return `<tr><td>${escapeHtml(s.name)}</td><td>${badge}</td></tr>`;
    }).join("\n");

    return `
      <div class="gap-section">
        <div class="gap-header">
          ${escapeHtml(gap.activityTypeName)} — ${escapeHtml(gap.name)}
          <span class="gap-date">(${dateStr})</span>
          <span class="gap-count">${hebrewCount(gap.soldiers.length, "פער", "פערים")}</span>
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

  const multi = data.platoons.length > 1;

  function platoonHeader(p: PlatoonForumSection): string {
    return multi ? `<div class="platoon-subheader">${escapeHtml(p.companyName)} — ${escapeHtml(p.platoonName)}</div>` : "";
  }

  function renderStatusSubsection(
    label: string,
    getReqs: (p: PlatoonForumSection) => OpenRequestItem[],
    options?: { highlightDates?: boolean },
  ): string {
    const total = data.platoons.reduce((s, p) => s + getReqs(p).length, 0);
    if (total === 0) return "";
    const platoonBlocks = data.platoons
      .filter((p) => getReqs(p).length > 0)
      .map((p) => `${platoonHeader(p)}${renderRequestCards(getReqs(p), options)}`)
      .join("\n");
    return `
      <div class="type-group">
        <div class="type-header">${escapeHtml(label)} (${total})</div>
        ${platoonBlocks}
      </div>
    `;
  }

  const requestTypes: Array<{
    title: string;
    open: (p: PlatoonForumSection) => OpenRequestItem[];
    active?: (p: PlatoonForumSection) => OpenRequestItem[];
  }> = [
    { title: "רפואה", open: (p) => p.openRequests.medical, active: (p) => p.activeRequests.medical },
    { title: 'ת"ש', open: (p) => p.openRequests.hardship },
    { title: "יציאה", open: (p) => p.openRequests.leave, active: (p) => p.activeRequests.leave },
  ];

  const totalRequests = requestTypes.reduce((s, rt) => {
    const o = data.platoons.reduce((ss, p) => ss + rt.open(p).length, 0);
    const a = rt.active ? data.platoons.reduce((ss, p) => ss + rt.active!(p).length, 0) : 0;
    return s + o + a;
  }, 0);

  const requestSectionsHtml = totalRequests === 0
    ? '<p class="no-data">אין בקשות</p>'
    : requestTypes
        .map((rt) => {
          const openTotal = data.platoons.reduce((s, p) => s + rt.open(p).length, 0);
          const activeTotal = rt.active ? data.platoons.reduce((s, p) => s + rt.active!(p).length, 0) : 0;
          if (openTotal + activeTotal === 0) return "";
          const openSection = renderStatusSubsection("ממתינות", rt.open);
          const activeSection = rt.active ? renderStatusSubsection("פעילות", rt.active, { highlightDates: true }) : "";
          return `
            <div class="section-block">
              <h3 class="section-title">${escapeHtml(rt.title)} (${openTotal + activeTotal})</h3>
              ${openSection}
              ${activeSection}
            </div>
          `;
        })
        .filter(Boolean)
        .join("\n");

  const totalCmdrEvents = data.platoons.reduce((s, p) => s + p.commanderEvents.length, 0);
  const cmdrEventsHtml = totalCmdrEvents > 0
    ? data.platoons
        .filter((p) => p.commanderEvents.length > 0)
        .map((p) => {
          const rows = p.commanderEvents.map((ev) => {
            const start = new Date(ev.startDate + "T12:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" });
            const end = new Date(ev.endDate + "T12:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" });
            const dateRange = ev.startDate === ev.endDate ? start : `${start} — ${end}`;
            return `<tr><td>${escapeHtml(ev.userName)}</td><td>${escapeHtml(CMDR_EVENT_TYPE_LABELS[ev.type] ?? ev.type)}</td><td>${dateRange}</td><td>${ev.description ? escapeHtml(ev.description) : ""}</td></tr>`;
          }).join("\n");
          return `${platoonHeader(p)}<table><thead><tr><th>מפקד</th><th>סוג</th><th>תאריכים</th><th>תיאור</th></tr></thead><tbody>${rows}</tbody></table>`;
        })
        .join("\n")
    : '<p class="no-data">אין אירועי מפקדים</p>';

  const totalIncidents = data.platoons.reduce((s, p) => s + p.incidents.length, 0);
  const incidentsHtml = totalIncidents > 0
    ? data.platoons
        .filter((p) => p.incidents.length > 0)
        .map((p) => {
          const rows = p.incidents.map((inc) => {
            const typeLabel = INCIDENT_TYPE_LABELS[inc.type as "commendation" | "discipline" | "safety"] ?? inc.type;
            const subtypeLabel = getSubtypeLabel(inc.type, inc.subtype);
            const fullLabel = subtypeLabel ? `${typeLabel} · ${subtypeLabel}` : typeLabel;
            const badgeColor =
              inc.type === "commendation"
                ? "background:#dcfce7;color:#166534;border:1px solid #bbf7d0;"
                : inc.type === "safety"
                ? "background:#fee2e2;color:#991b1b;border:1px solid #fecaca;"
                : "background:#fef3c7;color:#92400e;border:1px solid #fde68a;";
            const badge = `<span style="${badgeColor}padding:1px 8px;border-radius:9999px;font-size:11px;font-weight:500;white-space:nowrap;">${escapeHtml(fullLabel)}</span>`;
            return `<tr><td>${escapeHtml(inc.soldierName)}</td><td>${badge}</td><td>${escapeHtml(inc.description)}</td><td>${inc.response ? escapeHtml(inc.response) : ""}</td></tr>`;
          }).join("\n");
          return `${platoonHeader(p)}<table><thead><tr><th>חייל</th><th>סוג</th><th>תיאור</th><th>תגובה</th></tr></thead><tbody>${rows}</tbody></table>`;
        })
        .join("\n")
    : '<p class="no-data">אין אירועים</p>';

  const todayHtml = data.platoons.every((p) => p.todayActivities.length === 0)
    ? '<p class="no-data">אין פעילויות להיום</p>'
    : data.platoons
        .filter((p) => p.todayActivities.length > 0)
        .map((p) => `${platoonHeader(p)}${renderTodayActivitiesHtml(p.todayActivities)}`)
        .join("\n");

  const tomorrowHtml = data.platoons.every((p) => p.tomorrowActivities.length === 0)
    ? '<p class="no-data">אין פעילויות למחר</p>'
    : data.platoons
        .filter((p) => p.tomorrowActivities.length > 0)
        .map((p) => `${platoonHeader(p)}${renderTomorrowActivitiesHtml(p.tomorrowActivities)}`)
        .join("\n");

  const gapsHtml = data.platoons.every((p) => p.gaps.length === 0)
    ? '<p class="no-data">אין פערים</p>'
    : data.platoons
        .filter((p) => p.gaps.length > 0)
        .map((p) => `${platoonHeader(p)}${renderGapsHtml(p.gaps)}`)
        .join("\n");

  const platoonsHtml = `
    <div class="group-block">
      <h2 class="group-title">סיכום נוכחות</h2>
      <div class="group-content">
      ${data.attendance.length === 0 ? '<p class="no-data">אין נתונים</p>' : data.attendance.map((p) => {
        const absentRows = p.absent.length > 0
          ? `<table><thead><tr><th>חייל</th><th>כיתה</th><th>סטטוס</th><th>סיבה</th></tr></thead><tbody>${
              p.absent.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.squad)}</td><td>${escapeHtml(ATTENDANCE_STATUS_LABELS[s.status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? s.status)}</td><td>${s.reason ? escapeHtml(s.reason) : ""}</td></tr>`).join("\n")
            }</tbody></table>`
          : '<p class="no-data">כולם נוכחים</p>';
        return `
          ${multi ? `<div class="platoon-subheader">${escapeHtml(p.platoonName)} <span style="font-weight:400;color:#666">(${p.presentCount}/${p.totalCount})</span></div>` : `<p style="font-size:12px;font-weight:600;margin-bottom:6px;">נוכחים: ${p.presentCount}/${p.totalCount}</p>`}
          ${absentRows}
        `;
      }).join("\n")}
      </div>
    </div>

    <div class="group-block">
      <h2 class="group-title">בקשות (${totalRequests})</h2>
      ${requestSectionsHtml}
    </div>

    <div class="group-block">
      <h2 class="group-title">אירועי מפקדים (${totalCmdrEvents})</h2>
      <div class="group-content">${cmdrEventsHtml}</div>
    </div>

    <div class="group-block">
      <h2 class="group-title">אירועים (${totalIncidents})</h2>
      <div class="group-content">${incidentsHtml}</div>
    </div>

    <div class="group-block">
      <h2 class="group-title">הספקים</h2>
      <div class="section-block">
        <h3 class="section-title">פעילויות היום — ${escapeHtml(dateDisplay)}</h3>
        ${todayHtml}
      </div>

      <div class="section-block">
        <h3 class="section-title">פעילויות מחר — ${escapeHtml(tomorrowDisplay)}</h3>
        ${tomorrowHtml}
      </div>
    </div>

    <div class="group-block">
      <h2 class="group-title">תכנון מול ביצוע</h2>
      <div class="section-block">
        <h3 class="section-title">פערים</h3>
        ${gapsHtml}
      </div>
    </div>
  `;

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
    .platoon-subheader {
      font-size: 11px;
      font-weight: 600;
      background: #f5f5f5;
      padding: 3px 8px;
      margin: 8px 0 4px 0;
      border-right: 3px solid #666;
    }
    .group-block { margin-bottom: 28px; }
    .group-title {
      font-size: 15px;
      font-weight: 700;
      background: #f0f0f0;
      padding: 6px 10px;
      margin-bottom: 12px;
      border-right: 4px solid #333;
    }
    .group-content { padding-right: 20px; }
    .section-block { margin-bottom: 20px; padding-right: 20px; }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      border-bottom: 1px solid #999;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }
    /* Requests */
    .type-group { margin-bottom: 12px; padding-right: 16px; }
    .type-header {
      font-size: 11px;
      font-weight: 600;
      border-right: 2px solid #999;
      padding: 3px 8px;
      margin-bottom: 4px;
      color: #444;
    }
    .request-card {
      border-bottom: 1px solid #ddd;
      padding: 5px 8px;
    }
    .request-header {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .soldier-name { font-weight: 600; font-size: 11px; }
    .request-squad { font-size: 10px; color: #666; }
    .request-date { font-size: 10px; color: #666; }
    .request-badges { margin-right: auto; display: flex; gap: 4px; }
    .badge-status { background: #f3f4f6; color: #374151; }
    .badge-role { background: #fef3c7; color: #92400e; }
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
    .no-data { font-size: 11px; color: #999; padding-right: 20px; }
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
