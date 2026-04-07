import { prisma } from "@/lib/db/prisma";
import type { RequestType } from "@/types";
import {
  escapeHtml,
  formatDateTime,
  formatDate,
  TYPE_LABELS,
  TRANSPORTATION_LABELS,
} from "@/lib/reports/html-helpers";

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
  appointmentDate: string | null;
  appointmentPlace: string | null;
  appointmentType: string | null;
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
}


// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

export async function fetchRequestSummary(
  cycleId: string,
  platoonIds: string[],
  requestTypes?: string[],
  afterDate?: Date,
): Promise<RequestSummaryData | null> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  const requests = await prisma.request.findMany({
    where: {
      cycleId,
      status: "approved",
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

  // Map to summary items
  const items: RequestSummaryItem[] = requests.map((r) => ({
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
    appointmentDate: r.appointmentDate?.toISOString().split("T")[0] ?? null,
    appointmentPlace: r.appointmentPlace,
    appointmentType: r.appointmentType,
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
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderRequestDetails(req: RequestSummaryItem): string {
  const rows: string[] = [];

  if (req.description) {
    rows.push(`<span class="detail-label">תיאור:</span> ${escapeHtml(req.description)}`);
  }

  if (req.type === "leave") {
    if (req.place) rows.push(`<span class="detail-label">מקום:</span> ${escapeHtml(req.place)}`);
    if (req.departureAt) rows.push(`<span class="detail-label">יציאה:</span> ${formatDateTime(req.departureAt)}`);
    if (req.returnAt) rows.push(`<span class="detail-label">חזרה:</span> ${formatDateTime(req.returnAt)}`);
    if (req.transportation) rows.push(`<span class="detail-label">הגעה:</span> ${TRANSPORTATION_LABELS[req.transportation] ?? req.transportation}`);
  }

  if (req.type === "medical") {
    if (req.paramedicDate) rows.push(`<span class="detail-label">בדיקת חופ"ל:</span> ${formatDate(req.paramedicDate)}`);
    if (req.appointmentDate) rows.push(`<span class="detail-label">תור:</span> ${formatDate(req.appointmentDate)}`);
    if (req.appointmentPlace) rows.push(`<span class="detail-label">מקום:</span> ${escapeHtml(req.appointmentPlace)}`);
    if (req.appointmentType) rows.push(`<span class="detail-label">סוג:</span> ${escapeHtml(req.appointmentType)}`);
    if (req.sickLeaveDays != null) rows.push(`<span class="detail-label">ימי גימלים:</span> ${req.sickLeaveDays}`);
  }

  if (req.type === "hardship") {
    if (req.specialConditions != null) {
      rows.push(`<span class="detail-label">אוכלוסיות מיוחדות:</span> ${req.specialConditions ? "כן" : "לא"}`);
    }
  }

  for (const n of req.notes) {
    const actionLabel = n.action === "approve" ? "אישור" : n.action === "deny" ? "דחיה" : n.action;
    rows.push(`<span class="detail-label">${escapeHtml(n.userName)} (${actionLabel}):</span> ${escapeHtml(n.note)}`);
  }

  return rows.join('<span class="sep">·</span>');
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
    .map((group) => {
      if (group.level === "platoon") {
        return `<div class="platoon-header">${escapeHtml(group.label)}</div>`;
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
          <div class="squad-header">${escapeHtml(group.label)}</div>
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
      margin-top: 3px;
      padding-right: 4px;
    }
    .detail-label { font-weight: 600; }
    .sep { margin: 0 6px; color: #bbb; }
    .no-data { font-size: 11px; color: #999; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>דוח בקשות מאושרות — ${escapeHtml(data.cycleName)}</h1>
    <p>סה״כ ${data.totalCount} בקשות · תאריך הפקה: ${printDate}</p>
  </div>
  ${data.totalCount === 0 ? '<p class="no-data">אין בקשות מאושרות</p>' : groupsHtml}
</body>
</html>`;
}
