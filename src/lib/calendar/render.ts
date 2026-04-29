import { escapeHtml } from "@/lib/reports/html-helpers";
import {
  type CalendarEvent,
  type CalendarEventType,
  EVENT_TYPE_LABELS,
  groupEventsByDate,
} from "@/lib/calendar/events";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Platoon color palette (hex values for PDF)
// ---------------------------------------------------------------------------

const PLATOON_HEX_COLORS: { hex: string; hexBg: string; hexBorder: string }[] = [
  { hex: "#2563eb", hexBg: "#dbeafe", hexBorder: "#93c5fd" },
  { hex: "#059669", hexBg: "#d1fae5", hexBorder: "#6ee7b7" },
  { hex: "#d97706", hexBg: "#fef3c7", hexBorder: "#fcd34d" },
  { hex: "#7c3aed", hexBg: "#ede9fe", hexBorder: "#c4b5fd" },
  { hex: "#e11d48", hexBg: "#ffe4e6", hexBorder: "#fda4af" },
  { hex: "#0891b2", hexBg: "#cffafe", hexBorder: "#67e8f9" },
  { hex: "#ea580c", hexBg: "#ffedd5", hexBorder: "#fdba74" },
  { hex: "#4f46e5", hexBg: "#e0e7ff", hexBorder: "#a5b4fc" },
];

const EVENT_TYPE_HEX: Record<CalendarEventType, { hex: string; hexBg: string; hexBorder: string }> = {
  activity: { hex: "#2563eb", hexBg: "#dbeafe", hexBorder: "#93c5fd" },
  leave: { hex: "#d97706", hexBg: "#fef3c7", hexBorder: "#fcd34d" },
  medical_appointment: { hex: "#e11d48", hexBg: "#ffe4e6", hexBorder: "#fda4af" },
  sick_day: { hex: "#7c3aed", hexBg: "#ede9fe", hexBorder: "#c4b5fd" },
  commander_event: { hex: "#0d9488", hexBg: "#ccfbf1", hexBorder: "#5eead4" },
};

// ---------------------------------------------------------------------------
// Dynamic SVG icon rendering from lucide-react icon node data
// Reads the ESM source files to extract path data for any lucide icon name.
// ---------------------------------------------------------------------------

const SVG_OPEN = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-inline-end:2px;">';

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Read a lucide-react ESM icon file and extract its SVG children.
 * Icon names can be PascalCase ("DoorOpen") or kebab-case ("door-open").
 */
function lucideIconToSvg(iconName: string): string | null {
  const kebab = toKebabCase(iconName);
  try {
    const iconPath = join(
      process.cwd(),
      "node_modules/lucide-react/dist/esm/icons",
      `${kebab}.mjs`,
    );
    const src = readFileSync(iconPath, "utf8");
    // Extract the __iconNode array: const __iconNode = [ ... ];
    const match = src.match(/const __iconNode\s*=\s*(\[[\s\S]*?\]);\s/);
    if (!match) return null;

    // Parse the JS array (it uses JS object syntax with keys like { d: "...", key: "..." })
    // eslint-disable-next-line no-eval
    const nodes: [string, Record<string, string>][] = eval(match[1]);
    const children = nodes
      .map(([tag, attrs]) => {
        const attrStr = Object.entries(attrs)
          .filter(([k]) => k !== "key")
          .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
          .join(" ");
        return `<${tag} ${attrStr}/>`;
      })
      .join("");

    return `${SVG_OPEN}${children}</svg>`;
  } catch {
    return null;
  }
}

// Pre-render the fixed request type icons
const ICON_LEAVE = lucideIconToSvg("door-open") ?? "";
const ICON_MEDICAL = lucideIconToSvg("stethoscope") ?? "";
const ICON_SICK = lucideIconToSvg("thermometer") ?? "";
const ICON_COMMANDER = lucideIconToSvg("calendar-clock") ?? "";
const ICON_FALLBACK = lucideIconToSvg("clipboard-list") ?? "";

// Cache for activity type icons
const activityIconCache = new Map<string, string>();

function getEventIcon(event: CalendarEvent): string {
  switch (event.type) {
    case "leave": return ICON_LEAVE;
    case "medical_appointment": return ICON_MEDICAL;
    case "sick_day": return ICON_SICK;
    case "commander_event": return ICON_COMMANDER;
    case "activity": {
      if (!event.icon) return ICON_FALLBACK;
      let svg = activityIconCache.get(event.icon);
      if (svg === undefined) {
        svg = lucideIconToSvg(event.icon) ?? ICON_FALLBACK;
        activityIconCache.set(event.icon, svg);
      }
      return svg;
    }
  }
}

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// ---------------------------------------------------------------------------
// Build HTML
// ---------------------------------------------------------------------------

interface RenderCalendarOptions {
  cycleName: string;
  companyName: string | null;
  events: CalendarEvent[];
  platoons: { id: string; name: string }[];
  months: { year: number; month: number }[];
  visibleTypes: CalendarEventType[];
  /** If set, only show events from this platoon */
  filterPlatoonId?: string;
  /** If set, only show these event types */
  filterTypes?: CalendarEventType[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function renderCalendarHtml(opts: RenderCalendarOptions): string {
  const {
    cycleName,
    companyName,
    events,
    platoons,
    months,
    visibleTypes,
    filterPlatoonId,
    filterTypes,
  } = opts;

  const activePlatoons = filterPlatoonId
    ? platoons.filter((p) => p.id === filterPlatoonId)
    : platoons;
  const activeTypes = filterTypes ?? visibleTypes;
  const isMultiPlatoon = activePlatoons.length > 1;

  // Build platoon color map
  const platoonColorMap = new Map<string, (typeof PLATOON_HEX_COLORS)[0]>();
  platoons.forEach((p, i) => {
    platoonColorMap.set(p.id, PLATOON_HEX_COLORS[i % PLATOON_HEX_COLORS.length]);
  });

  // Filter events
  const filtered = events.filter((e) => {
    if (!activeTypes.includes(e.type)) return false;
    if (filterPlatoonId && e.platoonId !== filterPlatoonId) return false;
    return true;
  });

  const eventsByDate = groupEventsByDate(filtered);
  const todayStr = new Date().toISOString().split("T")[0];

  const printDate = new Date().toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  function getChipStyle(event: CalendarEvent): string {
    if (isMultiPlatoon) {
      const c = platoonColorMap.get(event.platoonId) ?? EVENT_TYPE_HEX[event.type];
      return `background:${c.hexBg};color:${c.hex};border:1px solid ${c.hexBorder};`;
    }
    const c = EVENT_TYPE_HEX[event.type];
    return `background:${c.hexBg};color:${c.hex};border:1px solid ${c.hexBorder};`;
  }

  function renderMonth(year: number, month: number): string {
    const monthName = new Date(year, month, 1).toLocaleDateString("he-IL", {
      month: "long",
      year: "numeric",
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const cells: { date: string; dayNumber: number; isCurrentMonth: boolean }[] = [];

    // Prev month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const pm = month === 0 ? 11 : month - 1;
      const py = month === 0 ? year - 1 : year;
      cells.push({ date: `${py}-${pad(pm + 1)}-${pad(d)}`, dayNumber: d, isCurrentMonth: false });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, dayNumber: d, isCurrentMonth: true });
    }
    // Next month padding
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      const nm = month === 11 ? 0 : month + 1;
      const ny = month === 11 ? year + 1 : year;
      for (let d = 1; d <= remaining; d++) {
        cells.push({ date: `${ny}-${pad(nm + 1)}-${pad(d)}`, dayNumber: d, isCurrentMonth: false });
      }
    }

    const weeks: string[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const row = cells.slice(i, i + 7);
      const tds = row
        .map((cell) => {
          const dayEvents = eventsByDate.get(cell.date) ?? [];
          const isToday = cell.date === todayStr;
          const bgStyle = !cell.isCurrentMonth ? "background:#f9fafb;" : "";
          const dayStyle = isToday
            ? "display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#273617;color:#fff;"
            : !cell.isCurrentMonth
              ? "color:#9ca3af;"
              : "";

          const chipHtml = dayEvents
            .slice(0, 6)
            .map(
              (e) =>
                `<div class="chip" style="${getChipStyle(e)}">${getEventIcon(e)}${escapeHtml(e.label)}</div>`,
            )
            .join("");
          const overflowHtml =
            dayEvents.length > 6
              ? `<div style="font-size:7px;color:#6b7280;padding:0 2px;">+${dayEvents.length - 6} נוספים</div>`
              : "";

          return `<td style="vertical-align:top;padding:3px;height:70px;${bgStyle}">
            <div style="${dayStyle}font-size:9px;font-weight:600;margin-bottom:2px;">${cell.dayNumber}</div>
            ${chipHtml}${overflowHtml}
          </td>`;
        })
        .join("");
      weeks.push(`<tr>${tds}</tr>`);
    }

    return `
      <div class="month-title">${escapeHtml(monthName)}</div>
      <table class="cal">
        <thead>
          <tr>${DAY_NAMES.map((n) => `<th>${n}</th>`).join("")}</tr>
        </thead>
        <tbody>${weeks.join("")}</tbody>
      </table>
    `;
  }

  // Legend HTML
  let legendHtml = "";
  if (isMultiPlatoon) {
    const items = activePlatoons
      .map((p) => {
        const c = platoonColorMap.get(p.id);
        if (!c) return "";
        return `<span class="legend-item"><span class="legend-dot" style="background:${c.hexBg};border:1px solid ${c.hexBorder};"></span>${escapeHtml(p.name)}</span>`;
      })
      .join("");
    legendHtml = `<div class="legend">${items}</div>`;
  } else {
    const items = activeTypes
      .map((type) => {
        const c = EVENT_TYPE_HEX[type];
        return `<span class="legend-item"><span class="legend-dot" style="background:${c.hexBg};border:1px solid ${c.hexBorder};"></span>${EVENT_TYPE_LABELS[type]}</span>`;
      })
      .join("");
    legendHtml = `<div class="legend">${items}</div>`;
  }

  const monthsHtml = months
    .map(({ year, month }, i) => {
      const pageBreak = i < months.length - 1 ? 'style="page-break-after:always;"' : "";
      return `<div class="month-page" ${pageBreak}>
        ${legendHtml}
        ${renderMonth(year, month)}
      </div>`;
    })
    .join("");

  const subtitle = companyName ? `${escapeHtml(companyName)} · ` : "";

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>לוח אירועים — ${escapeHtml(cycleName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans Hebrew', sans-serif;
      font-size: 10px;
      color: #1a1a1a;
      direction: rtl;
    }
    @page { size: A4 landscape; margin: 10mm; }
    .page-header {
      text-align: center;
      margin-bottom: 8px;
    }
    .page-header h1 { font-size: 16px; font-weight: 700; }
    .page-header p { font-size: 9px; color: #6b7280; margin-top: 2px; }
    .month-page { padding: 0 0 10px 0; }
    .month-title { font-size: 13px; font-weight: 700; margin: 8px 0 4px 0; }
    .legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 8px;
    }
    .legend-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .cal {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      direction: rtl;
    }
    .cal th {
      text-align: center;
      font-size: 8px;
      font-weight: 600;
      color: #6b7280;
      padding: 3px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
    }
    .cal td {
      border: 1px solid #e5e7eb;
      text-align: right;
    }
    .chip {
      font-size: 7px;
      line-height: 1.2;
      padding: 1px 3px;
      border-radius: 3px;
      margin-bottom: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      direction: rtl;
      text-align: right;
    }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>לוח אירועים</h1>
    <p>${subtitle}מחזור ${escapeHtml(cycleName)} · תאריך הפקה: ${printDate}</p>
  </div>
  ${monthsHtml}
</body>
</html>`;
}
