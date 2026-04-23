import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getReportScope } from "@/lib/api/report-scope";
import { refreshAccessToken } from "@/lib/reports/google-oauth";
import type { SessionUser } from "@/types";

export const maxDuration = 60;

const CATEGORY_LABELS: Record<string, string> = {
  physical: "אימון גופני",
  test: "בוחן",
  military: "אימון צבאי",
  navigation: "ניווט",
};

const WEEKS_COUNT = 30;
const FIXED_COLS = 4; // A=מס״ד, B=אחוז, C=שם, D=משפחה
const COLS_PER_WEEK = 13; // Sun-Fri = 6 days × 2 slots + Sat = 1
const HEADER_ROWS = 10; // rows 1-10 (0-indexed: 0-9)
const MAX_SOLDIERS = 50; // rows 11-60

// Day names for row 5-6 headers
const DAY_NAMES = ["יום א'", "יום ב'", "יום ג'", "יום ד'", "יום ה'", "יום ו'", "שבת"];

// Footer labels (rows 61-65)
const FOOTER_LABELS = [
  "מצבה פעילה:",
  'סה"כ משתתפים מלא+חלקי+תוכנית חזרה לאימונים:',
  "לא ביצעו מתוך מצבה פעילה",
  'סה"כ משתתפים מלא:',
  "אחוז משתתפים מלא:",
];

// ---------------------------------------------------------------------------
// POST /api/reports/physical-training/sheets?cycleId=...&spreadsheetId=...
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const targetSpreadsheetId = request.nextUrl.searchParams.get("spreadsheetId");

  const { scope, error, user } = await getReportScope(cycleId);
  if (error) return error;

  const sessionUser = user as SessionUser;

  // --- Google auth ---
  const exportToken = await prisma.googleExportToken.findUnique({
    where: { userId: sessionUser.id },
  });

  if (!exportToken) {
    return NextResponse.json({
      needsAuth: true,
      authUrl: `/api/reports/google/auth?cycleId=${cycleId}`,
    });
  }

  let accessToken = exportToken.accessToken;
  if (exportToken.expiresAt.getTime() < Date.now() + 60_000) {
    try {
      const refreshed = await refreshAccessToken(exportToken.refreshToken);
      accessToken = refreshed.accessToken;
      await prisma.googleExportToken.update({
        where: { userId: sessionUser.id },
        data: {
          accessToken: refreshed.accessToken,
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      });
    } catch {
      await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
      return NextResponse.json({
        needsAuth: true,
        authUrl: `/api/reports/google/auth?cycleId=${cycleId}`,
      });
    }
  }

  // --- Fetch data ---
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  // Get company name for the spreadsheet title
  const firstPlatoon = await prisma.platoon.findFirst({
    where: { id: { in: scope!.platoonIds } },
    select: { company: { select: { name: true } } },
  });
  const companyName = firstPlatoon?.company?.name ?? "";

  const activities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: scope!.platoonIds },
      activityType: { exportCategory: { not: null } },
    },
    include: {
      activityType: {
        select: { name: true, exportCategory: true },
      },
    },
    orderBy: { date: "asc" },
  });

  if (activities.length === 0) {
    return NextResponse.json(
      { error: "לא נמצאו פעילויות עם קטגוריית ייצוא" },
      { status: 404 }
    );
  }

  // Cycle start = Sunday of the first activity's week
  const cycleStartSunday = getWeekStartSunday(activities[0].date);

  const activityIds = activities.map((a) => a.id);
  const squads = await prisma.squad.findMany({
    where: { platoon: { id: { in: scope!.platoonIds } } },
    include: {
      platoon: { select: { id: true, name: true } },
      soldiers: {
        where: { status: "active", cycleId },
        select: {
          id: true,
          givenName: true,
          familyName: true,
          activityReports: {
            select: { activityId: true, result: true, note: true },
            where: { activityId: { in: activityIds } },
          },
        },
        orderBy: { familyName: "asc" },
      },
    },
    orderBy: [
      { platoon: { company: { sortOrder: "asc" } } },
      { platoon: { sortOrder: "asc" } },
      { sortOrder: "asc" },
    ],
  });

  // Group squads by platoon
  const platoonMap = new Map<string, { platoonName: string; squads: typeof squads }>();
  for (const squad of squads) {
    const pid = squad.platoon.id;
    if (!platoonMap.has(pid)) {
      platoonMap.set(pid, { platoonName: squad.platoon.name, squads: [] });
    }
    platoonMap.get(pid)!.squads.push(squad);
  }
  const platoonEntries = [...platoonMap.values()];
  const sheetTitles = platoonEntries.map((p) => p.platoonName);

  // Build sheet data per platoon
  const allSheetData = platoonEntries.map((pe) =>
    buildPlatoonSheet(
      pe,
      activities.filter((a) => pe.squads.some((sq) => sq.platoon.id === a.platoonId)),
      cycleStartSunday
    )
  );

  // --- Write to Google Sheets ---
  try {
    let spreadsheetId: string;
    let spreadsheetName: string;
    let sheetIdMap: Map<string, number>;
    let fileFallback = false;

    if (targetSpreadsheetId) {
      const result = await writeToExistingSpreadsheet(
        accessToken, targetSpreadsheetId, sheetTitles, cycle.name
      );
      if (result.notFound) {
        fileFallback = true;
        const fb = await createNewSpreadsheet(accessToken, sheetTitles, companyName, cycle.name);
        if (fb.needsAuth) {
          await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
          return NextResponse.json({ needsAuth: true, authUrl: `/api/reports/google/auth?cycleId=${cycleId}` });
        }
        spreadsheetId = fb.spreadsheetId!;
        spreadsheetName = fb.spreadsheetName!;
        sheetIdMap = fb.sheetIdMap!;
      } else if (result.needsAuth) {
        await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
        return NextResponse.json({ needsAuth: true, authUrl: `/api/reports/google/auth?cycleId=${cycleId}` });
      } else {
        spreadsheetId = result.spreadsheetId!;
        spreadsheetName = result.spreadsheetName!;
        sheetIdMap = result.sheetIdMap!;
      }
    } else {
      const result = await createNewSpreadsheet(accessToken, sheetTitles, companyName, cycle.name);
      if (result.needsAuth) {
        await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
        return NextResponse.json({ needsAuth: true, authUrl: `/api/reports/google/auth?cycleId=${cycleId}` });
      }
      spreadsheetId = result.spreadsheetId!;
      spreadsheetName = result.spreadsheetName!;
      sheetIdMap = result.sheetIdMap!;
    }

    // Write data
    const valueRanges = allSheetData.map((sd, i) => ({
      range: `'${sheetTitles[i]}'!A1`,
      values: sd.rows,
    }));
    await sheetsApiFetch(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      { valueInputOption: "RAW", data: valueRanges }
    );

    // Apply formatting
    const formatRequests = allSheetData.flatMap((sd, i) =>
      buildFormatRequests(sd, sheetIdMap.get(sheetTitles[i]) ?? i)
    );
    if (formatRequests.length > 0) {
      await sheetsApiFetch(
        accessToken,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: formatRequests }
      );
    }

    // Store default
    await prisma.reportExportDefault.upsert({
      where: { userId_reportType: { userId: sessionUser.id, reportType: "physical-training" } },
      create: { userId: sessionUser.id, reportType: "physical-training", spreadsheetId, spreadsheetName },
      update: { spreadsheetId, spreadsheetName },
    });

    return NextResponse.json({
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      spreadsheetId,
      spreadsheetName,
      fileFallback,
    });
  } catch (err) {
    console.error("Physical training sheets error:", err);
    return NextResponse.json({ error: "Failed to generate spreadsheet" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Sheet building
// ---------------------------------------------------------------------------

interface PlatoonSheetData {
  rows: string[][];
  totalCols: number;
  /** Cells to color: [rowIdx, colIdx, "green" | "yellow"] */
  coloredCells: [number, number, "green" | "yellow"][];
  /** Actual soldier count (for summary formulas) */
  soldierCount: number;
}

type ActivityRow = {
  id: string;
  date: Date;
  name: string;
  activityType: { name: string; exportCategory: string | null };
};

type SoldierRow = {
  id: string;
  givenName: string;
  familyName: string;
  activityReports: { activityId: string; result: string | null; note: string | null }[];
};

function getWeekStartSunday(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekIndex(date: Date, cycleStart: Date): number {
  const diff = date.getTime() - cycleStart.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}

/** Column index (0-based) for a given week + day-of-week + slot (0 or 1). */
function activityColIndex(week: number, dayOfWeek: number, slot: number): number {
  const weekOffset = FIXED_COLS + week * COLS_PER_WEEK;
  if (dayOfWeek === 6) return weekOffset + 12; // Shabbat — single column
  return weekOffset + dayOfWeek * 2 + slot;
}

function formatDateDM(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${d}/${m}`;
}

/** Get ISO week number for שבוע חיל האוויר */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function buildPlatoonSheet(
  platoonEntry: { platoonName: string; squads: { name: string; soldiers: SoldierRow[] }[] },
  platoonActivities: ActivityRow[],
  cycleStart: Date
): PlatoonSheetData {
  const totalCols = FIXED_COLS + WEEKS_COUNT * COLS_PER_WEEK;

  // Map activities to their column positions
  // Track slots used per (week, day) to assign slot 0 or 1
  const slotUsage = new Map<string, number>(); // "week-day" → next slot
  const activitySlots: { activity: ActivityRow; col: number }[] = [];

  for (const act of platoonActivities) {
    const week = getWeekIndex(act.date, cycleStart);
    if (week < 0 || week >= WEEKS_COUNT) continue;
    const day = act.date.getDay(); // 0=Sun ... 6=Sat
    const key = `${week}-${day}`;
    const slot = slotUsage.get(key) ?? 0;
    const maxSlots = day === 6 ? 1 : 2;
    if (slot >= maxSlots) continue; // skip if day is full
    slotUsage.set(key, slot + 1);
    activitySlots.push({ activity: act, col: activityColIndex(week, day, slot) });
  }

  // --- Build rows ---
  const makeRow = () => new Array(totalCols).fill("");

  // Row 1-2: Title (merged later)
  const row1 = makeRow();
  row1[0] = `מעקב השתתפות אחר חיילים באימונים`;
  const row2 = makeRow();

  // Row 3: Week numbers
  const row3 = makeRow();
  row3[0] = "מס״ד"; // merged A3:A10
  row3[1] = "אחוז ביצוע אימונים מלא:"; // merged B3:B10
  row3[2] = "שבוע מספר:";
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const weekStart = new Date(cycleStart);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const isoWeek = getISOWeek(weekStart);
    const col = FIXED_COLS + w * COLS_PER_WEEK;
    row3[col] = `שבוע ${w + 1} שבוע ${isoWeek} חיל האוויר`;
  }

  // Row 4: Weekly topic (blank)
  const row4 = makeRow();
  row4[2] = "נושא השבוע:";

  // Row 5: Day names (merged with row 6)
  const row5 = makeRow();
  row5[2] = "יום:";
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const weekBase = FIXED_COLS + w * COLS_PER_WEEK;
    for (let d = 0; d < 6; d++) {
      row5[weekBase + d * 2] = DAY_NAMES[d];
    }
    row5[weekBase + 12] = DAY_NAMES[6]; // שבת
  }

  // Row 6: Name + family label (merged with row 5 for day names)
  const row6 = makeRow();
  row6[2] = "שם + משפחה";

  // Row 7: Dates
  const row7 = makeRow();
  row7[2] = "תאריך:";
  // Fill dates for each day of each week
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const weekStart = new Date(cycleStart);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const weekBase = FIXED_COLS + w * COLS_PER_WEEK;
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + d);
      if (d === 6) {
        row7[weekBase + 12] = formatDateDM(dayDate);
      } else {
        row7[weekBase + d * 2] = formatDateDM(dayDate);
      }
    }
  }

  // Row 8: Training category (per activity column, NOT merged)
  const row8 = makeRow();
  row8[2] = "סוג האימון-קטגוריה:";
  for (const { activity, col } of activitySlots) {
    row8[col] = activity.activityType.exportCategory
      ? (CATEGORY_LABELS[activity.activityType.exportCategory] ?? "")
      : "";
  }

  // Row 9: Activity name (per activity column)
  const row9 = makeRow();
  row9[2] = "אימון מתוכנן (מלל):";
  for (const { activity, col } of activitySlots) {
    row9[col] = activity.name;
  }

  // Row 10: Actual training (blank)
  const row10 = makeRow();
  row10[2] = "אימון בפועל (מלל):";

  const rows: string[][] = [row1, row2, row3, row4, row5, row6, row7, row8, row9, row10];

  // --- Soldier data rows (rows 11-60) ---
  const allSoldiers: { soldier: SoldierRow }[] = [];
  for (const squad of platoonEntry.squads) {
    for (const soldier of squad.soldiers) {
      allSoldiers.push({ soldier });
    }
  }

  const coloredCells: [number, number, "green" | "yellow"][] = [];

  // Per-column stats for summary: keyed by column index
  const colStats = new Map<number, { withReport: number; passed: number; failed: number }>();
  for (const { col } of activitySlots) {
    colStats.set(col, { withReport: 0, passed: 0, failed: 0 });
  }

  for (let i = 0; i < MAX_SOLDIERS; i++) {
    const row = makeRow();
    row[0] = String(i + 1); // מס״ד
    if (i < allSoldiers.length) {
      const { soldier } = allSoldiers[i];
      row[2] = soldier.givenName;
      row[3] = soldier.familyName;

      const today = new Date();
      today.setHours(23, 59, 59, 999);
      let pastActivities = 0;
      let passedCount = 0;

      for (const { activity, col } of activitySlots) {
        const isPast = activity.date <= today;
        if (isPast) pastActivities++;

        const report = soldier.activityReports.find((r) => r.activityId === activity.id);
        if (!report || !report.result) continue;

        const stats = colStats.get(col)!;
        stats.withReport++;

        const rowIdx = HEADER_ROWS + i;
        if (report.result === "passed") {
          passedCount++;
          stats.passed++;
          row[col] = "ביצע מלא";
          coloredCells.push([rowIdx, col, "green"]);
        } else if (report.result === "na") {
          row[col] = "חייל לא פעיל";
          coloredCells.push([rowIdx, col, "yellow"]);
        } else {
          // failed — use note if available, default to "ביצע חלקי"
          stats.failed++;
          row[col] = report.note || "ביצע חלקי";
          coloredCells.push([rowIdx, col, "yellow"]);
        }
      }

      // Column B: participation percentage (only past/today activities)
      if (pastActivities > 0) {
        const pct = Math.round((passedCount / pastActivities) * 100);
        row[1] = `${pct}%`;
      }
    }
    rows.push(row);
  }

  // --- Footer / summary rows (rows 61-69) ---
  // Row 1: מצבה פעילה (soldiers with a report = active roster for that activity)
  // Row 2: participated (passed, option A: same as row 4)
  // Row 3: did not participate (failed)
  // Row 4: ביצע מלא (passed)
  // Row 5: percentage (row 4 / row 1)
  // Rows 6-9: duplicates of rows 3,1,2,4 (matches original sheet)
  for (let f = 0; f < FOOTER_LABELS.length; f++) {
    const row = makeRow();
    if (f === 0) row[0] = "סיכום מחלקתי"; // merged A61:A65
    row[1] = FOOTER_LABELS[f]; // merged B:D

    for (const { col } of activitySlots) {
      const s = colStats.get(col)!;
      switch (f) {
        case 0: // מצבה פעילה
          row[col] = s.withReport > 0 ? String(s.withReport) : "";
          break;
        case 1: // participated (= passed, option A)
          row[col] = s.withReport > 0 ? String(s.passed) : "";
          break;
        case 2: // לא ביצעו
          row[col] = s.withReport > 0 ? String(s.failed) : "";
          break;
        case 3: // ביצע מלא
          row[col] = s.withReport > 0 ? String(s.passed) : "";
          break;
        case 4: // אחוז משתתפים מלא
          if (s.withReport > 0) {
            row[col] = `${Math.round((s.passed / s.withReport) * 100)}%`;
          }
          break;
      }
    }

    rows.push(row);
  }

  return { rows, totalCols, coloredCells, soldierCount: allSoldiers.length };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function buildFormatRequests(sd: PlatoonSheetData, sheetId: number): object[] {
  const requests: object[] = [];
  const totalCols = sd.totalCols;

  // --- Merges ---

  // Title A1:D2 (rows 0-1, cols 0-3)
  requests.push(mergeCells(sheetId, 0, 2, 0, 4));

  // A3:A10 (מס״ד)
  requests.push(mergeCells(sheetId, 2, HEADER_ROWS, 0, 1));
  // B3:B10 (אחוז)
  requests.push(mergeCells(sheetId, 2, HEADER_ROWS, 1, 2));
  // C3:D3 through C10:D10 (label merges)
  for (let r = 2; r < HEADER_ROWS; r++) {
    requests.push(mergeCells(sheetId, r, r + 1, 2, 4));
  }

  // Week header merges (row 3 and row 4)
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const startCol = FIXED_COLS + w * COLS_PER_WEEK;
    const endCol = startCol + COLS_PER_WEEK;
    // Row 3: week number
    requests.push(mergeCells(sheetId, 2, 3, startCol, endCol));
    // Row 4: weekly topic
    requests.push(mergeCells(sheetId, 3, 4, startCol, endCol));
  }

  // Day name merges (rows 5-6): 2 cols × 2 rows for Sun-Fri, 1 col × 2 rows for Sat
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const weekBase = FIXED_COLS + w * COLS_PER_WEEK;
    for (let d = 0; d < 6; d++) {
      const col = weekBase + d * 2;
      requests.push(mergeCells(sheetId, 4, 6, col, col + 2)); // 2 cols × 2 rows
    }
    // Shabbat: 1 col × 2 rows
    requests.push(mergeCells(sheetId, 4, 6, weekBase + 12, weekBase + 13));
  }

  // Date merges (row 7): 2 cols per day Sun-Fri
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const weekBase = FIXED_COLS + w * COLS_PER_WEEK;
    for (let d = 0; d < 6; d++) {
      const col = weekBase + d * 2;
      requests.push(mergeCells(sheetId, 6, 7, col, col + 2));
    }
    // Sat is single col, no merge needed
  }

  // Footer merges
  const footerStart = HEADER_ROWS + MAX_SOLDIERS; // row 60 (0-indexed)
  // A61:A65 = "סיכום מחלקתי"
  requests.push(mergeCells(sheetId, footerStart, footerStart + 5, 0, 1));
  // B:D merge for each footer row
  for (let f = 0; f < FOOTER_LABELS.length; f++) {
    requests.push(mergeCells(sheetId, footerStart + f, footerStart + f + 1, 1, 4));
  }

  // --- Formatting ---

  // Title: bold, centered, wrapped
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 4 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 10 },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP",
        },
      },
      fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });

  const headerBg = { red: 0.93, green: 0.93, blue: 0.93 };

  // Header label cells (A-D, rows 3-10): wrap text so labels aren't clipped
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: HEADER_ROWS, startColumnIndex: 0, endColumnIndex: FIXED_COLS },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 7 },
          backgroundColor: headerBg,
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP",
        },
      },
      fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });

  // Header activity columns (E+ rows 3-10): clip to keep compact
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: HEADER_ROWS, startColumnIndex: FIXED_COLS, endColumnIndex: totalCols },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 7 },
          backgroundColor: headerBg,
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "CLIP",
        },
      },
      fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });

  // Footer rows: bold, grey background
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: footerStart,
        endRowIndex: footerStart + FOOTER_LABELS.length,
        startColumnIndex: 0,
        endColumnIndex: totalCols,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 7 },
          backgroundColor: headerBg,
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP",
        },
      },
      fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });

  // Data rows: small font, centered
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: HEADER_ROWS,
        endRowIndex: HEADER_ROWS + MAX_SOLDIERS,
        startColumnIndex: 0,
        endColumnIndex: totalCols,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { fontSize: 7 },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "CLIP",
        },
      },
      fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });

  // All cells: thin borders
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 2, endRowIndex: HEADER_ROWS + MAX_SOLDIERS + FOOTER_LABELS.length, startColumnIndex: 0, endColumnIndex: totalCols },
      top: thinBorder(),
      bottom: thinBorder(),
      left: thinBorder(),
      right: thinBorder(),
      innerHorizontal: thinBorder(),
      innerVertical: thinBorder(),
    },
  });

  // Colored cells (green = passed, yellow = non-pass with reason)
  for (const [rowIdx, colIdx, color] of sd.coloredCells) {
    const bg =
      color === "green"
        ? { red: 0.85, green: 0.94, blue: 0.85 }
        : { red: 1.0, green: 1.0, blue: 0.6 }; // yellow
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: colIdx,
          endColumnIndex: colIdx + 1,
        },
        cell: { userEnteredFormat: { backgroundColor: bg } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }

  // Freeze: 10 header rows + 4 fixed columns
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          frozenRowCount: HEADER_ROWS,
          frozenColumnCount: FIXED_COLS,
        },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // Column A (מס״ד): narrow
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 30 },
      fields: "pixelSize",
    },
  });

  // Column B (אחוז): narrow
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 45 },
      fields: "pixelSize",
    },
  });

  // Columns C-D (name): auto-resize
  requests.push({
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: FIXED_COLS },
    },
  });

  // Activity columns: tight 50px width
  if (totalCols > FIXED_COLS) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: FIXED_COLS, endIndex: totalCols },
        properties: { pixelSize: 50 },
        fields: "pixelSize",
      },
    });
  }

  // Title rows height
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 2 },
      properties: { pixelSize: 20 },
      fields: "pixelSize",
    },
  });

  // Header rows 3-10: compact
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: HEADER_ROWS },
      properties: { pixelSize: 18 },
      fields: "pixelSize",
    },
  });

  // Data rows: compact
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: HEADER_ROWS, endIndex: HEADER_ROWS + MAX_SOLDIERS },
      properties: { pixelSize: 18 },
      fields: "pixelSize",
    },
  });

  // Footer rows: compact
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: footerStart, endIndex: footerStart + FOOTER_LABELS.length },
      properties: { pixelSize: 18 },
      fields: "pixelSize",
    },
  });

  return requests;
}

function mergeCells(sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  return {
    mergeCells: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      mergeType: "MERGE_ALL",
    },
  };
}

function thinBorder() {
  return {
    style: "SOLID",
    width: 1,
    colorStyle: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } },
  };
}

// ---------------------------------------------------------------------------
// Sheets API helpers
// ---------------------------------------------------------------------------

interface SpreadsheetResult {
  spreadsheetId?: string;
  spreadsheetName?: string;
  sheetIdMap?: Map<string, number>;
  needsAuth?: boolean;
  notFound?: boolean;
}

async function sheetsApiFetch(accessToken: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Sheets API error (${url}):`, await res.text());
  }
  return res;
}

async function createNewSpreadsheet(
  accessToken: string,
  sheetTitles: string[],
  companyName: string,
  cycleName: string
): Promise<SpreadsheetResult> {
  const sheetProperties = sheetTitles.map((title, index) => ({
    properties: { sheetId: index, title, rightToLeft: true },
  }));

  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { title: `מעקב כשירות גופנית - ${companyName} - ${cycleName}`, locale: "iw" },
      sheets: sheetProperties,
    }),
  });

  if (!createRes.ok) {
    console.error("Sheets API create error:", await createRes.text());
    if (createRes.status === 401) return { needsAuth: true };
    throw new Error("Failed to create spreadsheet");
  }

  const spreadsheet = await createRes.json();
  const sheetIdMap = new Map<string, number>();
  for (let i = 0; i < sheetTitles.length; i++) {
    sheetIdMap.set(sheetTitles[i], i);
  }

  return {
    spreadsheetId: spreadsheet.spreadsheetId,
    spreadsheetName: spreadsheet.properties.title,
    sheetIdMap,
  };
}

async function writeToExistingSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitles: string[],
  _cycleName: string
): Promise<SpreadsheetResult> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    console.error(`[sheets] metadata fetch failed (${metaRes.status}) for ${spreadsheetId}:`, errText);
    if (metaRes.status === 404 || metaRes.status === 403) return { notFound: true };
    if (metaRes.status === 401) return { needsAuth: true };
    throw new Error("Failed to read spreadsheet");
  }

  const meta = await metaRes.json();
  const existingSheets: { properties: { sheetId: number; title: string } }[] = meta.sheets ?? [];

  const newTitleSet = new Set(sheetTitles);
  const existingByTitle = new Map(existingSheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const sheetsToDelete = existingSheets.filter((s) => newTitleSet.has(s.properties.title));

  const baseSheetId = Date.now() % 1_000_000_000;
  const requests: object[] = [];
  const needsRename: { sheetId: number; title: string }[] = [];

  for (let i = 0; i < sheetTitles.length; i++) {
    const title = sheetTitles[i];
    if (existingByTitle.has(title)) {
      const tempName = `__tmp_${baseSheetId + i}`;
      requests.push({
        addSheet: { properties: { sheetId: baseSheetId + i, title: tempName, rightToLeft: true } },
      });
      needsRename.push({ sheetId: baseSheetId + i, title });
    } else {
      requests.push({
        addSheet: { properties: { sheetId: baseSheetId + i, title, rightToLeft: true } },
      });
    }
  }

  for (const sheet of sheetsToDelete) {
    requests.push({ deleteSheet: { sheetId: sheet.properties.sheetId } });
  }

  for (const { sheetId: sid, title } of needsRename) {
    requests.push({
      updateSheetProperties: { properties: { sheetId: sid, title }, fields: "title" },
    });
  }

  const batchRes = await sheetsApiFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { requests }
  );

  if (!batchRes.ok) {
    if (batchRes.status === 401) return { needsAuth: true };
    throw new Error("Failed to update spreadsheet sheets");
  }

  const sheetIdMap = new Map<string, number>();
  for (let i = 0; i < sheetTitles.length; i++) {
    sheetIdMap.set(sheetTitles[i], baseSheetId + i);
  }

  return {
    spreadsheetId,
    spreadsheetName: meta.properties.title,
    sheetIdMap,
  };
}
