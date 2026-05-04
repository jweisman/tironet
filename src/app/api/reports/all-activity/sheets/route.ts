import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getReportScope } from "@/lib/api/report-scope";
import { refreshAccessToken } from "@/lib/reports/google-oauth";
import { dateRangeToAfterDate } from "@/lib/reports/date-range";
import type { SessionUser } from "@/types";
import type { ScoreConfig } from "@/types/score-config";
import { getActiveScores, evaluateScore } from "@/types/score-config";
import { formatGradeDisplay } from "@/lib/score-format";

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/reports/all-activity/sheets?cycleId=...&spreadsheetId=...
// "All Scores" report (UI label: כל הציונים) — limited to activity types
// that have at least one active score configured.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const typesParam = request.nextUrl.searchParams.get("activityTypeIds");
  const activityTypeIds = typesParam ? typesParam.split(",").filter(Boolean) : undefined;
  const afterDate = dateRangeToAfterDate(request.nextUrl.searchParams.get("dateRange"));
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStart = new Date(tomorrow.toISOString().split("T")[0] + "T00:00:00Z");
  const targetSpreadsheetId = request.nextUrl.searchParams.get("spreadsheetId");

  const { scope, error, user } = await getReportScope(cycleId);
  if (error) return error;

  const sessionUser = user as SessionUser;

  // Check if user has Google export tokens
  const exportToken = await prisma.googleExportToken.findUnique({
    where: { userId: sessionUser.id },
  });

  if (!exportToken) {
    return NextResponse.json({
      needsAuth: true,
      authUrl: `/api/reports/google/auth?cycleId=${cycleId}`,
    });
  }

  // Refresh token if expired (with 60s buffer)
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
      await prisma.googleExportToken.delete({
        where: { userId: sessionUser.id },
      });
      return NextResponse.json({
        needsAuth: true,
        authUrl: `/api/reports/google/auth?cycleId=${cycleId}`,
      });
    }
  }

  // Fetch data
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });

  if (!cycle) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  const squads = await prisma.squad.findMany({
    where: {
      platoon: {
        id: { in: scope!.platoonIds },
      },
    },
    include: {
      platoon: { select: { id: true, name: true } },
      soldiers: {
        where: { status: "active", cycleId },
        select: {
          id: true,
          givenName: true,
          familyName: true,
          activityReports: {
            select: {
              activityId: true,
              result: true,
              failed: true,
              grade1: true,
              grade2: true,
              grade3: true,
              grade4: true,
              grade5: true,
              grade6: true,
            },
            where: {
              activity: {
                cycleId,
                platoonId: { in: scope!.platoonIds },
                ...(activityTypeIds?.length ? { activityTypeId: { in: activityTypeIds } } : {}),
                date: {
                  ...(afterDate ? { gte: afterDate } : {}),
                  lt: tomorrowStart,
                },
              },
            },
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

  const allActivities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: scope!.platoonIds },
      ...(activityTypeIds?.length ? { activityTypeId: { in: activityTypeIds } } : {}),
      date: {
        ...(afterDate ? { gte: afterDate } : {}),
        lt: tomorrowStart,
      },
    },
    include: {
      activityType: {
        select: { name: true, scoreConfig: true },
      },
    },
    orderBy: { date: "asc" },
  });

  type ActivityWithType = (typeof allActivities)[number];

  function getActivityScores(a: ActivityWithType) {
    return getActiveScores(a.activityType.scoreConfig as ScoreConfig | null);
  }

  // Limit to activities whose type has at least one active score configured.
  const activities = allActivities.filter((a) => getActivityScores(a).length > 0);

  function formatActivityDate(d: Date): string {
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${d.getUTCFullYear()}`;
  }

  // Group squads by platoon → one sheet per platoon (only platoons with qualifying activities)
  const platoonMap = new Map<string, { platoonName: string; squads: typeof squads }>();
  for (const squad of squads) {
    const pid = squad.platoon.id;
    if (!platoonMap.has(pid)) {
      platoonMap.set(pid, { platoonName: squad.platoon.name, squads: [] });
    }
    platoonMap.get(pid)!.squads.push(squad);
  }
  const platoonEntries = [...platoonMap.values()].filter((entry) =>
    activities.some((a) => entry.squads.some((sq) => sq.platoon.id === a.platoonId)),
  );

  const sheetTitles = platoonEntries.map((p) => p.platoonName);

  // Per-cell formatting tracking (red bg for failed, grey for blank).
  type CellAddr = { row: number; col: number };

  const squadSheetData = platoonEntries.map((platoonEntry) => {
    const sheetTitle = platoonEntry.platoonName;
    const platoonActivities = activities.filter((a) =>
      platoonEntry.squads.some((sq) => sq.platoon.id === a.platoonId)
    );
    const scoresPerActivity = platoonActivities.map((a) => getActivityScores(a));
    // One column per active score per activity (no result column).
    const colCounts = scoresPerActivity.map((scores) => scores.length);
    // Total columns including the leading name column
    const totalCols = 1 + colCounts.reduce((a, b) => a + b, 0);

    // Header rows (offset by 1 for name column):
    // Row 0: activity name (merged per activity)
    // Row 1: activity date (merged per activity)
    // Row 2: activity notes (merged per activity)
    // Row 3: score labels per activity
    const activityNameRow: string[] = [""];
    const dateRow: string[] = [""];
    const notesRow: string[] = [""];
    const scoreLabelRow: string[] = ["שם"];

    for (let ai = 0; ai < platoonActivities.length; ai++) {
      const a = platoonActivities[ai];
      activityNameRow.push(`${a.activityType.name} - ${a.name}`);
      dateRow.push(formatActivityDate(a.date));
      notesRow.push(a.notes ?? "");
      for (let c = 1; c < colCounts[ai]; c++) {
        activityNameRow.push("");
        dateRow.push("");
        notesRow.push("");
      }
      const scores = scoresPerActivity[ai];
      for (const s of scores) scoreLabelRow.push(s.label);
    }

    // Data rows: squad header row, then soldier rows, repeated per squad.
    type SoldierRow = { values: string[]; rowIndex: number };
    const soldierRows: SoldierRow[] = [];
    const squadHeaderRowIndexes: number[] = [];
    const failedCells: CellAddr[] = [];
    const blankCells: CellAddr[] = [];
    const dataValueRows: string[][] = [];
    const HEADER_ROW_COUNT = 4;

    for (const squad of platoonEntry.squads) {
      // Squad header row (squad name in column A, rest empty — merged in formatting)
      const squadHeaderRow: string[] = [squad.name];
      for (let c = 1; c < totalCols; c++) squadHeaderRow.push("");
      squadHeaderRowIndexes.push(HEADER_ROW_COUNT + dataValueRows.length);
      dataValueRows.push(squadHeaderRow);

      for (const soldier of squad.soldiers) {
        const row: string[] = [`${soldier.familyName} ${soldier.givenName}`];
        const rowIndex = HEADER_ROW_COUNT + dataValueRows.length;
        let colCursor = 1;
        for (let ai = 0; ai < platoonActivities.length; ai++) {
          const report = soldier.activityReports.find(
            (r) => r.activityId === platoonActivities[ai].id
          );
          const scores = scoresPerActivity[ai];
          for (let c = 0; c < scores.length; c++) {
            const score = scores[c];
            const cellCol = colCursor + c;
            const g = report ? report[score.gradeKey] : null;
            if (g == null) {
              row.push("");
              blankCells.push({ row: rowIndex, col: cellCol });
            } else {
              row.push(formatGradeDisplay(Number(g), score.format));
              if (evaluateScore(Number(g), score.threshold, score.thresholdOperator) === "failed") {
                failedCells.push({ row: rowIndex, col: cellCol });
              }
            }
          }
          colCursor += scores.length;
        }
        soldierRows.push({ values: row, rowIndex });
        dataValueRows.push(row);
      }
    }

    return {
      sheetTitle,
      colCounts,
      totalCols,
      soldierRows,
      squadHeaderRowIndexes,
      failedCells,
      blankCells,
      hasNotes: platoonActivities.some((a) => (a.notes ?? "").trim() !== ""),
      valueRange: {
        range: `'${sheetTitle}'!A1`,
        values: [activityNameRow, dateRow, notesRow, scoreLabelRow, ...dataValueRows],
      },
    };
  });

  if (squadSheetData.length === 0) {
    return NextResponse.json(
      { error: "אין פעילויות עם ציונים בטווח הנבחר" },
      { status: 400 },
    );
  }

  try {
    let spreadsheetId: string;
    let spreadsheetName: string;
    let sheetIdMap: Map<string, number>; // title → sheetId for formatting
    let fileFallback = false;

    if (targetSpreadsheetId) {
      // ---------- Write to existing workbook ----------
      const result = await writeToExistingSpreadsheet(
        accessToken, targetSpreadsheetId, sheetTitles, squadSheetData, cycle.name
      );

      if (result.notFound) {
        // File was deleted or unshared — fall back to creating new
        fileFallback = true;
        const fallbackResult = await createNewSpreadsheet(
          accessToken, sheetTitles, squadSheetData, cycle.name
        );
        if (fallbackResult.needsAuth) {
          await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
          return NextResponse.json({ needsAuth: true, authUrl: `/api/reports/google/auth?cycleId=${cycleId}` });
        }
        spreadsheetId = fallbackResult.spreadsheetId!;
        spreadsheetName = fallbackResult.spreadsheetName!;
        sheetIdMap = fallbackResult.sheetIdMap!;
      } else if (result.needsAuth) {
        await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
        return NextResponse.json({ needsAuth: true, authUrl: `/api/reports/google/auth?cycleId=${cycleId}` });
      } else {
        spreadsheetId = result.spreadsheetId!;
        spreadsheetName = result.spreadsheetName!;
        sheetIdMap = result.sheetIdMap!;
      }
    } else {
      // ---------- Create new workbook ----------
      const result = await createNewSpreadsheet(
        accessToken, sheetTitles, squadSheetData, cycle.name
      );
      if (result.needsAuth) {
        await prisma.googleExportToken.delete({ where: { userId: sessionUser.id } });
        return NextResponse.json({ needsAuth: true, authUrl: `/api/reports/google/auth?cycleId=${cycleId}` });
      }
      spreadsheetId = result.spreadsheetId!;
      spreadsheetName = result.spreadsheetName!;
      sheetIdMap = result.sheetIdMap!;
    }

    // Populate data
    const valueRanges = squadSheetData.map((s) => s.valueRange);
    await sheetsApiFetch(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      { valueInputOption: "RAW", data: valueRanges }
    );

    // Apply formatting
    const formatRequests = buildFormatRequests(squadSheetData, sheetIdMap);
    await sheetsApiFetch(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: formatRequests }
    );

    // Store as default for next time
    await prisma.reportExportDefault.upsert({
      where: { userId_reportType: { userId: sessionUser.id, reportType: "all-activity" } },
      create: {
        userId: sessionUser.id,
        reportType: "all-activity",
        spreadsheetId,
        spreadsheetName,
      },
      update: { spreadsheetId, spreadsheetName },
    });

    return NextResponse.json({
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      spreadsheetId,
      spreadsheetName,
      fileFallback,
    });
  } catch (err) {
    console.error("Sheets generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate spreadsheet" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SheetData {
  sheetTitle: string;
  colCounts: number[];
  totalCols: number;
  soldierRows: { values: string[]; rowIndex: number }[];
  squadHeaderRowIndexes: number[];
  failedCells: { row: number; col: number }[];
  blankCells: { row: number; col: number }[];
  hasNotes: boolean;
  valueRange: { range: string; values: string[][] };
}

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
  _squadSheetData: SheetData[],
  cycleName: string
): Promise<SpreadsheetResult> {
  const sheetProperties = sheetTitles.map((title, index) => ({
    properties: { sheetId: index, title, rightToLeft: true },
  }));

  const createRes = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { title: `דוח ציונים - ${cycleName}`, locale: "iw" },
        sheets: sheetProperties,
      }),
    }
  );

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
  _squadSheetData: SheetData[],
  cycleName: string
): Promise<SpreadsheetResult> {
  // 1. Get existing spreadsheet metadata
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
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

  // 2. Build batchUpdate: replace only sheets with matching names, leave others
  const newTitleSet = new Set(sheetTitles);
  const existingByTitle = new Map(existingSheets.map((s) => [s.properties.title, s.properties.sheetId]));

  // Delete only existing sheets whose name matches a new sheet title
  const sheetsToDelete = existingSheets.filter((s) => newTitleSet.has(s.properties.title));

  // For new sheets that DON'T collide with existing names, add directly with final name.
  // For those that DO collide, add with temp name, delete old, then rename.
  const baseSheetId = Date.now() % 1_000_000_000;
  const requests: object[] = [];
  const needsRename: { sheetId: number; title: string }[] = [];

  for (let i = 0; i < sheetTitles.length; i++) {
    const title = sheetTitles[i];
    if (existingByTitle.has(title)) {
      // Name collision — use temp name, rename after delete
      const tempName = `__tmp_${baseSheetId + i}`;
      requests.push({
        addSheet: {
          properties: { sheetId: baseSheetId + i, title: tempName, rightToLeft: true },
        },
      });
      needsRename.push({ sheetId: baseSheetId + i, title });
    } else {
      // No collision — add with final name directly
      requests.push({
        addSheet: {
          properties: { sheetId: baseSheetId + i, title, rightToLeft: true },
        },
      });
    }
  }

  // Delete old sheets that share names with new ones
  for (const sheet of sheetsToDelete) {
    requests.push({
      deleteSheet: { sheetId: sheet.properties.sheetId },
    });
  }

  // Rename temp sheets to final names
  for (const { sheetId, title } of needsRename) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, title },
        fields: "title",
      },
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

function buildFormatRequests(
  squadSheetData: SheetData[],
  sheetIdMap: Map<string, number>
): object[] {
  return squadSheetData.flatMap((sd) => {
    const sheetId = sheetIdMap.get(sd.sheetTitle) ?? 0;

    // Merge activity name (row 0), date (row 1), and notes (row 2) per activity.
    // Offset by 1 for the leading name column.
    const mergeRequests: object[] = [];
    let colOffset = 1;
    for (const colCount of sd.colCounts) {
      if (colCount > 1) {
        for (const headerRow of [0, 1, 2]) {
          mergeRequests.push({
            mergeCells: {
              range: {
                sheetId,
                startRowIndex: headerRow,
                endRowIndex: headerRow + 1,
                startColumnIndex: colOffset,
                endColumnIndex: colOffset + colCount,
              },
              mergeType: "MERGE_ALL",
            },
          });
        }
      }
      colOffset += colCount;
    }

    // Merge each squad header row across all columns (col 1..totalCols)
    const squadMergeRequests: object[] = [];
    for (const ri of sd.squadHeaderRowIndexes) {
      if (sd.totalCols > 1) {
        squadMergeRequests.push({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: ri,
              endRowIndex: ri + 1,
              startColumnIndex: 1,
              endColumnIndex: sd.totalCols,
            },
            mergeType: "MERGE_ALL",
          },
        });
      }
    }

    // Red background + bold for failed score cells
    const failedCellRequests: object[] = sd.failedCells.map((cell) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: cell.row,
          endRowIndex: cell.row + 1,
          startColumnIndex: cell.col,
          endColumnIndex: cell.col + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 },
            textFormat: {
              bold: true,
              foregroundColorStyle: { rgbColor: { red: 0.7, green: 0.05, blue: 0.05 } },
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    }));

    // Light grey background for blank score cells
    const blankCellRequests: object[] = sd.blankCells.map((cell) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: cell.row,
          endRowIndex: cell.row + 1,
          startColumnIndex: cell.col,
          endColumnIndex: cell.col + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    }));

    // Squad header rows: bold, dark grey background, centered
    const squadHeaderFormatRequests: object[] = sd.squadHeaderRowIndexes.map((ri) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: ri, endRowIndex: ri + 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.78, green: 0.78, blue: 0.78 },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
      },
    }));

    return [
      ...mergeRequests,
      ...squadMergeRequests,
      // Header rows formatting (4 rows: name, date, notes, labels)
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 4 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
              horizontalAlignment: "CENTER",
              wrapStrategy: "WRAP",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,wrapStrategy,verticalAlignment)",
        },
      },
      // Notes row may need extra height when present
      ...(sd.hasNotes
        ? [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 },
                properties: { pixelSize: 60 },
                fields: "pixelSize",
              },
            },
          ]
        : []),
      ...squadHeaderFormatRequests,
      ...blankCellRequests,
      ...failedCellRequests,
      // Freeze 4 header rows + 1 column (name)
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 4, frozenColumnCount: 1 },
          },
          fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
        },
      },
      // Auto-resize columns
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: sd.totalCols,
          },
        },
      },
    ];
  });
}
