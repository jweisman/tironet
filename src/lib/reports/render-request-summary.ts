import { prisma } from "@/lib/db/prisma";
import type { RequestType, RequestStatus } from "@/types";
import {
  escapeHtml,
  formatDateTime,
  formatDate,
  TYPE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/reports/html-helpers";
import { parseMedicalAppointments, hasUpcomingAppointment, formatAppointment } from "@/lib/requests/medical-appointments";
import type { MedicalAppointment } from "@/lib/requests/medical-appointments";
import {
  extractRequestFields,
  formatNotes,
  renderDetailColumnsHtml,
  DETAIL_COLUMNS_CSS,
} from "@/lib/reports/detail-columns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestSummaryItem {
  id: string;
  type: string;
  typeLabel: string;
  soldierName: string;
  squad: string;
  platoon: string;
  company: string;
  createdAt: string;
  description: string | null;
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
  // Audit trail notes (from approve/deny actions)
  notes: { action: string; userName: string; note: string }[];
}

export interface RequestSummaryGroup {
  label: string; // e.g. "מחלקה 1 — כיתה א"
  level: "platoon" | "squad";
  requests: RequestSummaryItem[];
}

export interface RequestSummaryData {
  cycleName: string;
  groups: RequestSummaryGroup[];
  totalCount: number;
  statusFilter: RequestStatusFilter;
}

export type RequestStatusFilter = "open_active" | "open" | "active" | "approved" | "all";

export const STATUS_FILTER_LABELS: Record<RequestStatusFilter, string> = {
  open_active: "פתוחות",
  open: "ממתינות",
  active: "פעילות",
  approved: "מאושרות",
  all: "הכל",
};


// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/**
 * Check if an approved request is "active" — currently relevant based on type-specific dates.
 * Matches the Active tab definition from the requests list page.
 */
function isActiveRequest(r: { type: string; departureAt: Date | null; returnAt: Date | null; medicalAppointments: unknown }): boolean {
  const today = new Date().toISOString().split("T")[0];
  if (r.type === "leave") {
    const dep = r.departureAt?.toISOString().split("T")[0];
    const ret = r.returnAt?.toISOString().split("T")[0];
    return (dep != null && dep >= today) || (ret != null && ret >= today);
  }
  if (r.type === "medical") {
    const appts = parseMedicalAppointments(r.medicalAppointments as string | null);
    return hasUpcomingAppointment(appts);
  }
  // Hardship is always active
  return true;
}

export async function fetchRequestSummary(
  cycleId: string,
  platoonIds: string[],
  requestTypes?: string[],
  afterDate?: Date,
  statusFilter: RequestStatusFilter = "open_active",
): Promise<RequestSummaryData | null> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  // Build status filter for the Prisma query
  const statusCondition: Record<string, unknown> =
    statusFilter === "open" ? { status: "open" }
    : statusFilter === "active" || statusFilter === "approved" ? { status: "approved" }
    : statusFilter === "open_active" ? { status: { in: ["open", "approved"] } }
    : {}; // "all" — no status filter

  const requests = await prisma.request.findMany({
    where: {
      cycleId,
      ...statusCondition,
      soldier: {
        squad: {
          platoon: { id: { in: platoonIds } },
        },
      },
      ...(requestTypes && requestTypes.length > 0
        ? { type: { in: requestTypes as RequestType[] } }
        : {}),
      ...(afterDate ? { createdAt: { gte: afterDate } } : {}),
    },
    include: {
      soldier: {
        include: {
          squad: {
            include: {
              platoon: {
                include: { company: true },
              },
            },
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

  // Post-query filter: "active" and "open_active" need date-based filtering
  // for approved requests (open requests pass through as-is)
  const needsActiveFilter = statusFilter === "active" || statusFilter === "open_active";
  const filtered = needsActiveFilter
    ? requests.filter((r) => r.status === "open" || isActiveRequest(r))
    : requests;

  // Map to summary items
  const items: RequestSummaryItem[] = filtered.map((r) => ({
    id: r.id,
    type: r.type,
    typeLabel: TYPE_LABELS[r.type] ?? r.type,
    soldierName: `${r.soldier.familyName} ${r.soldier.givenName}`,
    squad: r.soldier.squad.name,
    platoon: r.soldier.squad.platoon.name,
    company: r.soldier.squad.platoon.company.name,
    createdAt: r.createdAt.toISOString(),
    description: r.description,
    place: r.place,
    departureAt: r.departureAt?.toISOString() ?? null,
    returnAt: r.returnAt?.toISOString() ?? null,
    transportation: r.transportation,
    paramedicDate: r.paramedicDate?.toISOString().split("T")[0] ?? null,
    medicalAppointments: parseMedicalAppointments(r.medicalAppointments as string | null),
    sickLeaveDays: r.sickLeaveDays,
    specialConditions: r.specialConditions,
    notes: (r.actions ?? [])
      .filter((a): a is typeof a & { note: string } => a.note != null)
      .map((a) => ({ action: a.action, userName: a.userName, note: a.note })),
  }));

  // Group by platoon → squad
  const groupMap = new Map<string, RequestSummaryItem[]>();
  for (const item of items) {
    const key = `${item.company}|${item.platoon}|${item.squad}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }

  // Sort groups by company → platoon → squad (using sort orders from first item's soldier)
  const sortedKeys = [...groupMap.keys()].sort((a, b) => a.localeCompare(b));

  const groups: RequestSummaryGroup[] = [];
  let lastPlatoon = "";
  for (const key of sortedKeys) {
    const reqs = groupMap.get(key)!;
    const first = reqs[0];
    const platoonKey = `${first.company}|${first.platoon}`;

    if (platoonKey !== lastPlatoon) {
      // Add platoon header group (empty requests — just a label)
      groups.push({
        label: `${first.company} — ${first.platoon}`,
        level: "platoon",
        requests: [],
      });
      lastPlatoon = platoonKey;
    }

    groups.push({
      label: first.squad,
      level: "squad",
      requests: reqs,
    });
  }

  return {
    cycleName: cycle.name,
    groups,
    totalCount: items.length,
    statusFilter,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const htmlFormatters = {
  text: escapeHtml,
  dateTime: formatDateTime,
  date: formatDate,
  appointment: formatAppointment,
  transportationLabels: TRANSPORTATION_LABELS,
};

function renderRequestDetails(req: RequestSummaryItem): string {
  const { fields, appointments } = extractRequestFields(req, htmlFormatters);

  const notes = formatNotes(req.notes, escapeHtml);

  return renderDetailColumnsHtml({ fields, appointments, notes });
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

export function renderRequestSummaryHtml(data: RequestSummaryData): string {
  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const groupsHtml = data.groups
    .map((group, gi) => {
      if (group.level === "platoon") {
        let platoonCount = 0;
        for (let j = gi + 1; j < data.groups.length && data.groups[j].level === "squad"; j++) {
          platoonCount += data.groups[j].requests.length;
        }
        return `<div class="platoon-header">${escapeHtml(group.label)} <span class="group-count">(${platoonCount})</span></div>`;
      }

      const requestRows = group.requests
        .map((req) => {
          const dateStr = formatDateTime(req.createdAt);
          const details = renderRequestDetails(req);
          return `
            <div class="request-card">
              <div class="request-header">
                <span class="request-type">${escapeHtml(req.typeLabel)}</span>
                <span class="soldier-name">${escapeHtml(req.soldierName)}</span>
                <span class="request-date">${dateStr}</span>
              </div>
              ${details ? `<div class="request-details">${details}</div>` : ""}
            </div>
          `;
        })
        .join("\n");

      return `
        <div class="squad-section">
          <div class="squad-header">${escapeHtml(group.label)} <span class="group-count">(${group.requests.length})</span></div>
          ${requestRows}
        </div>
      `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>דוח בקשות — ${escapeHtml(data.cycleName)}</title>
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
      font-size: 14px;
      font-weight: 700;
      background: #e0e0e0;
      padding: 6px 10px;
      margin-top: 20px;
      margin-bottom: 4px;
    }
    .squad-section {
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    .squad-header {
      font-size: 12px;
      font-weight: 600;
      background: #f0f0f0;
      padding: 4px 10px;
      margin-bottom: 4px;
    }
    .group-count {
      font-weight: 400;
      color: #999;
    }
    .request-card {
      border-bottom: 1px solid #ddd;
      padding: 6px 10px;
    }
    .request-header {
      display: flex;
      gap: 12px;
      align-items: baseline;
    }
    .request-type {
      font-weight: 600;
      font-size: 11px;
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 1px 6px;
    }
    .soldier-name { font-weight: 600; font-size: 11px; }
    .request-date { font-size: 10px; color: #666; }
    .request-details {
      font-size: 10px;
      color: #444;
      margin-top: 4px;
      padding-right: 4px;
    }
${DETAIL_COLUMNS_CSS}
    .no-data { font-size: 11px; color: #999; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>דוח בקשות — ${escapeHtml(data.cycleName)}</h1>
    <p>${STATUS_FILTER_LABELS[data.statusFilter]} · סה״כ ${data.totalCount} בקשות · תאריך הפקה: ${printDate}</p>
  </div>
  ${data.totalCount === 0 ? '<p class="no-data">אין בקשות</p>' : groupsHtml}
</body>
</html>`;
}
