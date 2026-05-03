import { prisma } from "@/lib/db/prisma";
import { escapeHtml } from "@/lib/reports/html-helpers";
import { getActiveScores, parseScoreConfig, evaluateScore } from "@/types/score-config";
import { formatGradeDisplay } from "@/lib/score-format";
import { INCIDENT_TYPE_LABELS, getSubtypeLabel, type IncidentType } from "@/lib/incidents/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalFileData {
  cycleName: string;
  soldier: SoldierProfile;
}

export interface SoldierProfile {
  id: string;
  givenName: string;
  familyName: string;
  idNumber: string | null;
  civilianId: string | null;
  rank: string | null;
  status: string;
  profileImage: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  street: string | null;
  apt: string | null;
  city: string | null;
  notes: string | null;
  dateOfBirth: string | null;
  platoonName: string;
  squadName: string;
  incidents: IncidentEntry[];
  homeVisits: HomeVisitEntry[];
  requests: RequestEntry[];
  activities: ActivityEntry[];
}

interface IncidentEntry {
  type: string;
  subtype: string | null;
  date: string;
  description: string;
  response: string | null;
  createdByName: string;
}

interface HomeVisitEntry {
  date: string;
  status: string;
  notes: string | null;
  createdByName: string;
}

interface RequestEntry {
  type: string;
  status: string;
  description: string | null;
  createdAt: string;
}

interface ActivityEntry {
  name: string;
  typeName: string;
  date: string;
  result: string;
  failed: boolean;
  scores: { label: string; value: string; result: "passed" | "failed" | null }[];
  note: string | null;
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  mother: "אמא",
  father: "אבא",
  sibling: "אח/אחות",
  spouse: "בן/בת זוג",
  friend: "חבר/ה",
  other: "אחר",
};

const STATUS_LABELS: Record<string, string> = {
  active: "פעיל",
  transferred: "הועבר",
  dropped: "נשר",
  injured: "פצוע",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  leave: "יציאה",
  medical: "רפואה",
  hardship: "ת\"ש",
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "ממתינה",
  approved: "אושרה",
  denied: "נדחתה",
};

const HOME_VISIT_STATUS_LABELS: Record<string, string> = {
  in_order: "תקין",
  deficiencies: "ליקויים",
};

const RESULT_LABELS: Record<string, string> = {
  completed: "ביצע",
  skipped: "לא ביצע",
  na: "לא רלוונטי",
};

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchPersonalFile(
  cycleId: string,
  soldierId: string,
): Promise<PersonalFileData | null> {
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    include: {
      squad: {
        select: {
          name: true,
          platoon: { select: { name: true } },
        },
      },
      cycle: { select: { name: true } },
      incidents: {
        orderBy: { date: "desc" },
        select: { type: true, subtype: true, date: true, description: true, response: true, createdByName: true },
      },
      homeVisits: {
        orderBy: { date: "desc" },
        select: { date: true, status: true, notes: true, createdByName: true },
      },
      requests: {
        orderBy: { createdAt: "desc" },
        select: { type: true, status: true, description: true, createdAt: true },
      },
      activityReports: {
        include: {
          activity: {
            select: {
              name: true,
              date: true,
              status: true,
              activityType: { select: { name: true, scoreConfig: true } },
            },
          },
        },
        orderBy: { activity: { date: "desc" } },
      },
    },
  });

  if (!soldier) return null;

  // Filter to scored activities only (at least one non-null grade)
  const activities: ActivityEntry[] = soldier.activityReports
    .filter((ar) => {
      const hasScores = [ar.grade1, ar.grade2, ar.grade3, ar.grade4, ar.grade5, ar.grade6].some((g) => g != null);
      return hasScores;
    })
    .map((ar) => {
      const rawConfig = ar.activity.activityType.scoreConfig;
      const config = parseScoreConfig(typeof rawConfig === "string" ? rawConfig : rawConfig ? JSON.stringify(rawConfig) : null);
      const activeScores = getActiveScores(config);
      const grades = [ar.grade1, ar.grade2, ar.grade3, ar.grade4, ar.grade5, ar.grade6].map((g) => g != null ? Number(g) : null);

      const scores = activeScores
        .map((s) => {
          const grade = grades[parseInt(s.key.replace("score", "")) - 1];
          if (grade == null) return null;
          const result = evaluateScore(grade, s.threshold, s.thresholdOperator);
          return { label: s.label, value: formatGradeDisplay(grade, s.format), result };
        })
        .filter((s): s is NonNullable<typeof s> => s != null);

      return {
        name: ar.activity.name,
        typeName: ar.activity.activityType.name,
        date: ar.activity.date.toISOString().split("T")[0],
        result: ar.result,
        failed: ar.failed,
        scores,
        note: ar.note,
      };
    });

  return {
    cycleName: soldier.cycle.name,
    soldier: {
      id: soldier.id,
      givenName: soldier.givenName,
      familyName: soldier.familyName,
      idNumber: soldier.idNumber,
      civilianId: soldier.civilianId,
      rank: soldier.rank,
      status: soldier.status,
      profileImage: soldier.profileImage,
      phone: soldier.phone,
      emergencyPhone: soldier.emergencyPhone,
      emergencyContactName: soldier.emergencyContactName,
      emergencyContactRelationship: soldier.emergencyContactRelationship,
      street: soldier.street,
      apt: soldier.apt,
      city: soldier.city,
      notes: soldier.notes,
      dateOfBirth: soldier.dateOfBirth ? soldier.dateOfBirth.toISOString().split("T")[0] : null,
      platoonName: soldier.squad.platoon.name,
      squadName: soldier.squad.name,
      incidents: soldier.incidents.map((i) => ({
        type: i.type,
        subtype: i.subtype,
        date: i.date.toISOString().split("T")[0],
        description: i.description,
        response: i.response,
        createdByName: i.createdByName,
      })),
      homeVisits: soldier.homeVisits.map((hv) => ({
        date: hv.date.toISOString().split("T")[0],
        status: hv.status,
        notes: hv.notes,
        createdByName: hv.createdByName,
      })),
      requests: soldier.requests.map((r) => ({
        type: r.type,
        status: r.status,
        description: r.description,
        createdAt: r.createdAt.toISOString().split("T")[0],
      })),
      activities,
    },
  };
}

// ---------------------------------------------------------------------------
// HTML Render
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function sectionTitle(title: string): string {
  return `<h2 style="font-size:13px;font-weight:700;color:#374151;margin:18px 0 8px;padding:4px 8px;background:#f3f4f6;border-radius:4px;border-right:3px solid #374151;">${escapeHtml(title)}</h2>`;
}

function badge(text: string, bg: string, color: string): string {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:500;background:${bg};color:${color};white-space:nowrap;">${escapeHtml(text)}</span>`;
}

export function renderPersonalFileHtml(data: PersonalFileData): string {
  const s = data.soldier;
  const printDate = new Date().toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });

  // Personal details
  const profileImgHtml = s.profileImage
    ? `<img src="${s.profileImage}" style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:2px solid #e5e7eb;" />`
    : `<div style="width:90px;height:90px;border-radius:50%;background:#d1d5db;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:white;">${escapeHtml((s.givenName[0] ?? "") + (s.familyName[0] ?? ""))}</div>`;

  const unitLine = `${escapeHtml(s.platoonName)} / ${escapeHtml(s.squadName)}${s.rank ? ` · ${escapeHtml(s.rank)}` : ""}`;
  const idLines: string[] = [];
  if (s.idNumber) idLines.push(`מ.א. ${escapeHtml(s.idNumber)}`);
  if (s.civilianId) idLines.push(`מ.ז. ${escapeHtml(s.civilianId)}`);
  const dobLine = s.dateOfBirth ? `ת.לידה ${formatDate(s.dateOfBirth)}` : null;

  const statusBadge = badge(STATUS_LABELS[s.status] ?? s.status, s.status === "active" ? "#dcfce7" : "#fef3c7", s.status === "active" ? "#166534" : "#92400e");

  // Contact details
  const contactLines: string[] = [];
  if (s.phone) contactLines.push(`<tr><td style="color:#6b7280;padding:2px 0;">טלפון:</td><td style="padding:2px 8px;" dir="ltr">${escapeHtml(s.phone)}</td></tr>`);
  if (s.street || s.city) {
    const addr = [s.street, s.apt ? `דירה ${s.apt}` : null, s.city].filter(Boolean).join(", ");
    contactLines.push(`<tr><td style="color:#6b7280;padding:2px 0;">כתובת:</td><td style="padding:2px 8px;">${escapeHtml(addr)}</td></tr>`);
  }

  // Emergency contact
  const emergencyLines: string[] = [];
  if (s.emergencyContactName) {
    const rel = s.emergencyContactRelationship ? ` (${RELATIONSHIP_LABELS[s.emergencyContactRelationship] ?? s.emergencyContactRelationship})` : "";
    emergencyLines.push(`<tr><td style="color:#6b7280;padding:2px 0;">שם:</td><td style="padding:2px 8px;">${escapeHtml(s.emergencyContactName)}${escapeHtml(rel)}</td></tr>`);
  }
  if (s.emergencyPhone) {
    emergencyLines.push(`<tr><td style="color:#6b7280;padding:2px 0;">טלפון:</td><td style="padding:2px 8px;" dir="ltr">${escapeHtml(s.emergencyPhone)}</td></tr>`);
  }

  // Notes
  const notesHtml = s.notes
    ? `<p style="font-size:11px;white-space:pre-wrap;">${escapeHtml(s.notes)}</p>`
    : '<p style="font-size:11px;color:#9ca3af;">אין הערות</p>';

  // Incidents
  const incidentsHtml = s.incidents.length === 0
    ? '<p style="font-size:11px;color:#9ca3af;">אין אירועים</p>'
    : `<table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="border-bottom:2px solid #e5e7eb;"><th style="text-align:start;padding:4px 6px;">תאריך</th><th style="text-align:start;padding:4px 6px;">סוג</th><th style="text-align:start;padding:4px 6px;">תיאור</th><th style="text-align:start;padding:4px 6px;">תגובה</th></tr></thead>
        <tbody>${s.incidents.map((i) => {
          const typeLabel = INCIDENT_TYPE_LABELS[i.type as IncidentType] ?? i.type;
          const subtypeLabel = getSubtypeLabel(i.type, i.subtype);
          const fullLabel = subtypeLabel ? `${typeLabel} · ${subtypeLabel}` : typeLabel;
          const typeBadge =
            i.type === "commendation"
              ? badge(fullLabel, "#dcfce7", "#166534")
              : i.type === "safety"
              ? badge(fullLabel, "#fee2e2", "#991b1b")
              : badge(fullLabel, "#fef3c7", "#92400e");
          return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:4px 6px;">${formatDate(i.date)}</td><td style="padding:4px 6px;">${typeBadge}</td><td style="padding:4px 6px;">${escapeHtml(i.description)}</td><td style="padding:4px 6px;color:#6b7280;">${i.response ? escapeHtml(i.response) : ""}</td></tr>`;
        }).join("")}</tbody>
      </table>`;

  // Home visits
  const homeVisitsHtml = s.homeVisits.length === 0
    ? '<p style="font-size:11px;color:#9ca3af;">אין ביקורי בית</p>'
    : `<table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="border-bottom:2px solid #e5e7eb;"><th style="text-align:start;padding:4px 6px;">תאריך</th><th style="text-align:start;padding:4px 6px;">סטטוס</th><th style="text-align:start;padding:4px 6px;">הערות</th><th style="text-align:start;padding:4px 6px;">נוצר ע״י</th></tr></thead>
        <tbody>${s.homeVisits.map((hv) => {
          const statusBdg = hv.status === "in_order"
            ? badge(HOME_VISIT_STATUS_LABELS[hv.status], "#dcfce7", "#166534")
            : badge(HOME_VISIT_STATUS_LABELS[hv.status], "#fef3c7", "#92400e");
          return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:4px 6px;">${formatDate(hv.date)}</td><td style="padding:4px 6px;">${statusBdg}</td><td style="padding:4px 6px;">${hv.notes ? escapeHtml(hv.notes) : ""}</td><td style="padding:4px 6px;color:#6b7280;">${escapeHtml(hv.createdByName)}</td></tr>`;
        }).join("")}</tbody>
      </table>`;

  // Requests
  const requestsHtml = s.requests.length === 0
    ? '<p style="font-size:11px;color:#9ca3af;">אין בקשות</p>'
    : `<table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="border-bottom:2px solid #e5e7eb;"><th style="text-align:start;padding:4px 6px;">תאריך</th><th style="text-align:start;padding:4px 6px;">סוג</th><th style="text-align:start;padding:4px 6px;">סטטוס</th><th style="text-align:start;padding:4px 6px;">תיאור</th></tr></thead>
        <tbody>${s.requests.map((r) => {
          return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:4px 6px;">${formatDate(r.createdAt)}</td><td style="padding:4px 6px;">${escapeHtml(REQUEST_TYPE_LABELS[r.type] ?? r.type)}</td><td style="padding:4px 6px;">${escapeHtml(REQUEST_STATUS_LABELS[r.status] ?? r.status)}</td><td style="padding:4px 6px;">${r.description ? escapeHtml(r.description) : ""}</td></tr>`;
        }).join("")}</tbody>
      </table>`;

  // Activities (scored only)
  const activitiesHtml = s.activities.length === 0
    ? '<p style="font-size:11px;color:#9ca3af;">אין פעילויות עם ציונים</p>'
    : `<table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="border-bottom:2px solid #e5e7eb;"><th style="text-align:start;padding:4px 6px;">תאריך</th><th style="text-align:start;padding:4px 6px;">פעילות</th><th style="text-align:start;padding:4px 6px;">תוצאה</th><th style="text-align:start;padding:4px 6px;">ציונים</th><th style="text-align:start;padding:4px 6px;">הערה</th></tr></thead>
        <tbody>${s.activities.map((a) => {
          const resultText = RESULT_LABELS[a.result] ?? a.result;
          const failedBadge = a.failed ? ` ${badge("נכשל", "#fee2e2", "#991b1b")}` : "";
          const scoresText = a.scores.map((sc) => {
            const color = sc.result === "failed" ? "color:#d97706;font-weight:600;" : sc.result === "passed" ? "color:#16a34a;" : "";
            return `<span style="${color}">${escapeHtml(sc.label)}: ${escapeHtml(sc.value)}</span>`;
          }).join(" · ");
          return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:4px 6px;">${formatDate(a.date)}</td><td style="padding:4px 6px;">${escapeHtml(a.name)}<br/><span style="color:#6b7280;font-size:10px;">${escapeHtml(a.typeName)}</span></td><td style="padding:4px 6px;">${escapeHtml(resultText)}${failedBadge}</td><td style="padding:4px 6px;">${scoresText}</td><td style="padding:4px 6px;color:#6b7280;">${a.note ? escapeHtml(a.note) : ""}</td></tr>`;
        }).join("")}</tbody>
      </table>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1f2937; margin: 0; padding: 0; line-height: 1.5; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div>
      <h1 style="font-size:18px;font-weight:700;margin:0;">${escapeHtml(s.familyName)} ${escapeHtml(s.givenName)}</h1>
      <p style="font-size:11px;color:#6b7280;margin:2px 0;">תיק אישי · ${escapeHtml(data.cycleName)}</p>
    </div>
    <div style="text-align:left;">
      <p style="font-size:10px;color:#9ca3af;margin:0;">הופק ${escapeHtml(printDate)}</p>
    </div>
  </div>

  <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:12px;">
    ${profileImgHtml}
    <div style="flex:1;">
      <div style="margin-bottom:4px;">${statusBadge}</div>
      <p style="font-size:11px;color:#6b7280;margin:0;">${unitLine}</p>
      ${idLines.length > 0 ? `<p style="font-size:11px;color:#6b7280;margin:0;">${idLines.join(" · ")}</p>` : ""}
      ${dobLine ? `<p style="font-size:11px;color:#6b7280;margin:0;">${dobLine}</p>` : ""}
    </div>
  </div>

  ${sectionTitle("פרטי קשר")}
  ${contactLines.length > 0 ? `<table style="font-size:11px;">${contactLines.join("")}</table>` : '<p style="font-size:11px;color:#9ca3af;">לא הוזנו פרטי קשר</p>'}

  ${sectionTitle("איש קשר לחירום")}
  ${emergencyLines.length > 0 ? `<table style="font-size:11px;">${emergencyLines.join("")}</table>` : '<p style="font-size:11px;color:#9ca3af;">לא הוזן איש קשר לחירום</p>'}

  ${sectionTitle("הערות")}
  ${notesHtml}

  ${sectionTitle(`אירועים (${s.incidents.length})`)}
  ${incidentsHtml}

  ${sectionTitle(`ביקורי בית (${s.homeVisits.length})`)}
  ${homeVisitsHtml}

  ${sectionTitle(`בקשות (${s.requests.length})`)}
  ${requestsHtml}

  ${sectionTitle(`פעילויות עם ציונים (${s.activities.length})`)}
  ${activitiesHtml}
</body>
</html>`;
}
