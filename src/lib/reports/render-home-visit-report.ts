import { prisma } from "@/lib/db/prisma";
import { escapeHtml, formatDate } from "@/lib/reports/html-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HomeVisitEntry {
  date: string; // YYYY-MM-DD
  status: "in_order" | "deficiencies" | string;
  notes: string | null;
  createdByName: string;
}

export interface HomeVisitSoldier {
  id: string;
  name: string;
  visits: HomeVisitEntry[];
}

export interface HomeVisitSquad {
  id: string;
  name: string;
  soldiers: HomeVisitSoldier[];
}

export interface HomeVisitPlatoon {
  platoonId: string;
  platoonName: string;
  companyName: string;
  squads: HomeVisitSquad[];
  visitedCount: number;
  totalCount: number;
}

export interface HomeVisitReportData {
  cycleName: string;
  platoons: HomeVisitPlatoon[];
  totalVisited: number;
  totalSoldiers: number;
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const HOME_VISIT_STATUS_LABELS: Record<string, string> = {
  in_order: "תקין",
  deficiencies: "ליקויים",
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

export async function fetchHomeVisitReport(
  cycleId: string,
  platoonIds: string[],
): Promise<HomeVisitReportData | null> {
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
      homeVisits: {
        orderBy: { date: "desc" },
        select: {
          date: true,
          status: true,
          notes: true,
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

  const platoonMap = new Map<string, HomeVisitPlatoon>();

  for (const s of soldiers) {
    const platoon = s.squad.platoon;
    const pid = platoon.id;

    if (!platoonMap.has(pid)) {
      platoonMap.set(pid, {
        platoonId: pid,
        platoonName: platoon.name,
        companyName: platoon.company.name,
        squads: [],
        visitedCount: 0,
        totalCount: 0,
      });
    }

    const pEntry = platoonMap.get(pid)!;

    let squad = pEntry.squads.find((sq) => sq.id === s.squad.id);
    if (!squad) {
      squad = { id: s.squad.id, name: s.squad.name, soldiers: [] };
      pEntry.squads.push(squad);
    }

    const visits: HomeVisitEntry[] = s.homeVisits.map((hv) => ({
      date: hv.date.toISOString().split("T")[0],
      status: hv.status,
      notes: hv.notes,
      createdByName: hv.createdByName,
    }));

    squad.soldiers.push({
      id: s.id,
      name: `${s.familyName} ${s.givenName}`,
      visits,
    });

    pEntry.totalCount++;
    if (visits.length > 0) pEntry.visitedCount++;
  }

  const platoons = [...platoonMap.values()];
  const totalVisited = platoons.reduce((s, p) => s + p.visitedCount, 0);
  const totalSoldiers = platoons.reduce((s, p) => s + p.totalCount, 0);

  return {
    cycleName: cycle.name,
    platoons,
    totalVisited,
    totalSoldiers,
  };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

export function renderHomeVisitReportHtml(data: HomeVisitReportData): string {
  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const multi = data.platoons.length > 1;

  function statusBadge(status: string): string {
    const label = HOME_VISIT_STATUS_LABELS[status] ?? status;
    const cls = status === "in_order" ? "status-ok" : "status-deficient";
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function renderVisitsCell(visits: HomeVisitEntry[]): string {
    if (visits.length === 0) {
      return `<span class="no-visit">לא בוצע</span>`;
    }
    return visits
      .map((v) => {
        const notes = v.notes ? `<div class="visit-notes">${escapeHtml(v.notes)}</div>` : "";
        return `<div class="visit">
          <div class="visit-meta">${formatDate(v.date)} ${statusBadge(v.status)}</div>
          ${notes}
        </div>`;
      })
      .join("");
  }

  const platoonsHtml = data.platoons
    .map((platoon) => {
      const squadsHtml = platoon.squads
        .map((squad) => {
          const rowsHtml = squad.soldiers
            .map(
              (s) => `
        <tr>
          <td class="name-cell">${escapeHtml(s.name)}</td>
          <td class="visits-cell">${renderVisitsCell(s.visits)}</td>
        </tr>`,
            )
            .join("\n");

          return `
        <div class="squad-section">
          <div class="squad-header">${escapeHtml(squad.name)}</div>
          <table>
            <thead><tr><th class="name-col">חייל</th><th>ביקורי בית</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
        })
        .join("\n");

      return `
      <div class="platoon-section">
        ${
          multi
            ? `<div class="platoon-header">${escapeHtml(platoon.companyName)} — ${escapeHtml(platoon.platoonName)} <span class="count">(${platoon.visitedCount}/${platoon.totalCount})</span></div>`
            : ""
        }
        ${squadsHtml}
      </div>
    `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>דוח ביקורי בית — ${escapeHtml(data.cycleName)}</title>
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
    .summary {
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 20px;
    }
    .summary .count { color: #166534; }
    .platoon-section { margin-bottom: 24px; }
    .platoon-header {
      font-size: 16px;
      font-weight: 700;
      background: #1a1a1a;
      color: #fff;
      padding: 8px 12px;
      margin-bottom: 12px;
    }
    .platoon-header .count { font-weight: 400; font-size: 13px; }
    .squad-section {
      margin-bottom: 16px;
    }
    .squad-header {
      font-size: 12px;
      font-weight: 600;
      background: #f0f0f0;
      padding: 4px 8px;
      margin-bottom: 4px;
      border-right: 3px solid #666;
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: start; padding: 5px 8px; font-weight: 700; border-bottom: 2px solid #333; background: #f5f5f5; }
    td { padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr { page-break-inside: avoid; }
    .name-col { width: 30%; }
    .name-cell { font-weight: 600; }
    .visits-cell { font-size: 11px; }
    .visit { margin-bottom: 6px; }
    .visit:last-child { margin-bottom: 0; }
    .visit-meta { display: flex; gap: 8px; align-items: center; }
    .visit-notes { color: #555; font-size: 10px; margin-top: 2px; white-space: pre-wrap; }
    .no-visit { color: #9ca3af; font-style: italic; font-size: 10px; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .status-ok { background: #dcfce7; color: #166534; }
    .status-deficient { background: #fef3c7; color: #92400e; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>דוח ביקורי בית — ${escapeHtml(data.cycleName)}</h1>
    <p>תאריך הפקה: ${printDate}</p>
  </div>
  <div class="summary">בוצעו ביקורי בית: <span class="count">${data.totalVisited}/${data.totalSoldiers}</span></div>
  ${platoonsHtml}
</body>
</html>`;
}
