import { prisma } from "@/lib/db/prisma";
import { parseMedicalAppointments, formatAppointment } from "@/lib/requests/medical-appointments";
import { parseSickDays } from "@/lib/requests/sick-days";
import { escapeHtml, formatDate } from "@/lib/reports/html-helpers";
import { getIsraelDates } from "@/lib/reports/render-daily-forum";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttendanceStatus = "present" | "leave" | "medical_appointment" | "sick_day" | "inactive";

export interface AttendanceSoldier {
  id: string;
  name: string;
  status: AttendanceStatus;
  reason: string | null;
}

export interface AttendanceSquad {
  id: string;
  name: string;
  soldiers: AttendanceSoldier[];
}

export interface AttendancePlatoon {
  platoonId: string;
  platoonName: string;
  companyName: string;
  squads: AttendanceSquad[];
  presentCount: number;
  totalCount: number;
}

export interface AttendanceData {
  cycleName: string;
  date: string;
  platoons: AttendancePlatoon[];
  totalPresent: number;
  totalSoldiers: number;
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "נוכח",
  leave: "יציאה",
  medical_appointment: "תור רפואי",
  sick_day: "יום מחלה",
  inactive: "לא פעיל",
};

const INACTIVE_REASON: Record<string, string> = {
  transferred: "הועבר",
  dropped: "נשר",
  injured: "פצוע",
};

export { STATUS_LABELS, INACTIVE_REASON };

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

export async function fetchAttendance(
  cycleId: string,
  platoonIds: string[],
  dateStr?: string,
): Promise<AttendanceData | null> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  const { today } = getIsraelDates(dateStr);

  // Fetch all soldiers grouped by squad/platoon
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
    },
    orderBy: [
      { squad: { platoon: { company: { sortOrder: "asc" } } } },
      { squad: { platoon: { sortOrder: "asc" } } },
      { squad: { sortOrder: "asc" } },
      { familyName: "asc" },
      { givenName: "asc" },
    ],
  });

  // Fetch approved leave and medical requests for these soldiers
  const soldierIds = soldiers.map((s) => s.id);
  const requests = await prisma.request.findMany({
    where: {
      status: "approved",
      type: { in: ["leave", "medical"] },
      soldierId: { in: soldierIds },
    },
    select: {
      soldierId: true,
      type: true,
      departureAt: true,
      returnAt: true,
      medicalAppointments: true,
      sickDays: true,
    },
  });

  // Build soldier → absence reason map
  const absenceMap = new Map<string, { status: AttendanceStatus; reason: string }>();

  for (const req of requests) {
    if (absenceMap.has(req.soldierId)) continue; // first match wins

    if (req.type === "leave") {
      const dep = req.departureAt?.toISOString().split("T")[0];
      const ret = req.returnAt?.toISOString().split("T")[0];
      if (dep && ret && dep <= today && ret >= today) {
        absenceMap.set(req.soldierId, { status: "leave", reason: `עד ${formatDate(ret)}` });
      }
    }

    if (req.type === "medical") {
      const appts = parseMedicalAppointments(req.medicalAppointments as string | null);
      const todayAppt = appts.find((a) => a.date.split("T")[0] === today);
      if (todayAppt) {
        absenceMap.set(req.soldierId, { status: "medical_appointment", reason: formatAppointment(todayAppt) });
        continue;
      }

      const days = parseSickDays(req.sickDays as string | null);
      const todaySick = days.find((d) => d.date === today);
      if (todaySick) {
        absenceMap.set(req.soldierId, { status: "sick_day", reason: "יום מחלה" });
      }
    }
  }

  // Group by platoon → squad
  const platoonMap = new Map<string, AttendancePlatoon>();

  for (const s of soldiers) {
    const platoon = s.squad.platoon;
    const pid = platoon.id;

    if (!platoonMap.has(pid)) {
      platoonMap.set(pid, {
        platoonId: pid,
        platoonName: platoon.name,
        companyName: platoon.company.name,
        squads: [],
        presentCount: 0,
        totalCount: 0,
      });
    }

    const pEntry = platoonMap.get(pid)!;

    let squad = pEntry.squads.find((sq) => sq.id === s.squad.id);
    if (!squad) {
      squad = { id: s.squad.id, name: s.squad.name, soldiers: [] };
      pEntry.squads.push(squad);
    }

    let attendanceStatus: AttendanceStatus;
    let reason: string | null = null;

    if (s.status !== "active") {
      attendanceStatus = "inactive";
      reason = INACTIVE_REASON[s.status] ?? s.status;
    } else {
      const absence = absenceMap.get(s.id);
      if (absence) {
        attendanceStatus = absence.status;
        reason = absence.reason;
      } else {
        attendanceStatus = "present";
      }
    }

    squad.soldiers.push({
      id: s.id,
      name: `${s.familyName} ${s.givenName}`,
      status: attendanceStatus,
      reason,
    });

    pEntry.totalCount++;
    if (attendanceStatus === "present") pEntry.presentCount++;
  }

  const platoons = [...platoonMap.values()];
  const totalPresent = platoons.reduce((s, p) => s + p.presentCount, 0);
  const totalSoldiers = platoons.reduce((s, p) => s + p.totalCount, 0);

  return {
    cycleName: cycle.name,
    date: today,
    platoons,
    totalPresent,
    totalSoldiers,
  };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

export function renderAttendanceHtml(data: AttendanceData): string {
  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric", month: "long", year: "numeric",
  });

  const dateDisplay = new Date(data.date + "T12:00:00").toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const multi = data.platoons.length > 1;

  function statusClass(s: AttendanceStatus): string {
    switch (s) {
      case "present": return "status-present";
      case "leave": return "status-leave";
      case "medical_appointment": return "status-medical";
      case "sick_day": return "status-sick";
      case "inactive": return "status-inactive";
    }
  }

  const platoonsHtml = data.platoons.map((platoon) => {
    const squadsHtml = platoon.squads.map((squad) => {
      const rowsHtml = squad.soldiers.map((s) => `
        <tr>
          <td>${escapeHtml(s.name)}</td>
          <td><span class="badge ${statusClass(s.status)}">${STATUS_LABELS[s.status]}</span></td>
          <td class="reason">${s.reason ? escapeHtml(s.reason) : ""}</td>
        </tr>
      `).join("\n");

      return `
        <div class="squad-section">
          <div class="squad-header">${escapeHtml(squad.name)}</div>
          <table>
            <thead><tr><th>חייל</th><th>סטטוס</th><th>סיבה</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    }).join("\n");

    return `
      <div class="platoon-section">
        ${multi ? `<div class="platoon-header">${escapeHtml(platoon.companyName)} — ${escapeHtml(platoon.platoonName)} <span class="count">(${platoon.presentCount}/${platoon.totalCount})</span></div>` : ""}
        ${squadsHtml}
      </div>
    `;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>דוח נוכחות — ${escapeHtml(data.cycleName)}</title>
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
      page-break-inside: avoid;
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
    td { padding: 4px 8px; border-bottom: 1px solid #ddd; }
    .reason { font-size: 10px; color: #666; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .status-present { background: #dcfce7; color: #166534; }
    .status-leave { background: #fef3c7; color: #92400e; }
    .status-medical { background: #dbeafe; color: #1e40af; }
    .status-sick { background: #fce7f3; color: #9d174d; }
    .status-inactive { background: #f3f4f6; color: #6b7280; }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>דוח נוכחות — ${escapeHtml(data.cycleName)}</h1>
    <p>${escapeHtml(dateDisplay)} · תאריך הפקה: ${printDate}</p>
  </div>
  <div class="summary">נוכחים: <span class="count">${data.totalPresent}/${data.totalSoldiers}</span></div>
  ${platoonsHtml}
</body>
</html>`;
}
