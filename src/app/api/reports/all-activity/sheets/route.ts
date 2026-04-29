import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getReportScope } from "@/lib/api/report-scope";
import { refreshAccessToken } from "@/lib/reports/google-oauth";
import { dateRangeToAfterDate } from "@/lib/reports/date-range";
import type { SessionUser } from "@/types";
import type { ScoreConfig } from "@/types/score-config";
import { getActiveScores } from "@/types/score-config";
import { formatGradeDisplay } from "@/lib/score-format";

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/reports/all-activity/sheets?cycleId=...&spreadsheetId=...
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

  const activities = await prisma.activity.findMany({
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

  function getActivityScores(a: typeof activities[number]) {
    return getActiveScores(a.activityType.scoreConfig as ScoreConfig | null);
  }

  // Group squads by platoon → one sheet per platoon
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

  const squadSheetData = platoonEntries.map((platoonEntry) => {
    const sheetTitle = platoonEntry.platoonName;
    const platoonActivities = activities.filter((a) =>
      platoonEntry.squads.some((sq) => sq.platoon.id === a.platoonId)
    );
    const scoresPerActivity = platoonActivities.map((a) => getActivityScores(a));
    // +1 for result column per activity
    const colCounts = scoresPerActivity.map((scores) => Math.max(scores.length, 1) + 1);
    const totalCols = colCounts.reduce((a, b) => a + b, 0);

    // Row 1: merged activity name headers (extra col for "כיתה")
    const activityNameRow: string[] = ["", ""];
    for (let ai = 0; ai < platoonActivities.length; ai++) {
      const a = platoonActivities[ai];
      activityNameRow.push(`${a.activityType.name} - ${a.name}`);
      for (let c = 1; c < colCounts[ai]; c++) activityNameRow.push("");
    }

    // Row 2: score labels
    const scoreLabelRow: string[] = ["חייל", "כיתה"];
    for (let ai = 0; ai < platoonActivities.length; ai++) {
      const scores = scoresPerActivity[ai];
      scoreLabelRow.push("תוצאה");
      if (scores.length <= 1) {
        scoreLabelRow.push(scores[0]?.label ?? "ציון");
      } else {
        for (const s of scores) scoreLabelRow.push(s.label);
      }
    }

    // Data rows: all soldiers across all squads in this platoon
    type SoldierRow = { values: string[]; failedActivities: number[] };
    const soldierRows: SoldierRow[] = [];
    const passCountPerActivity = new Array(platoonActivities.length).fill(0);
    const failCountPerActivity = new Array(platoonActivities.length).fill(0);

    for (const squad of platoonEntry.squads) {
      for (const soldier of squad.soldiers) {
        const row: string[] = [`${soldier.familyName} ${soldier.givenName}`, squad.name];
        const failedActivities: number[] = [];
        for (let ai = 0; ai < platoonActivities.length; ai++) {
          const report = soldier.activityReports.find(
            (r) => r.activityId === platoonActivities[ai].id
          );
          const scores = scoresPerActivity[ai];
          const scoreColCount = Math.max(scores.length, 1);
          if (!report) {
            row.push("");
            for (let c = 0; c < scoreColCount; c++) row.push("");
          } else {
            const resultLabel = report.result === "completed" ? "עבר" : report.result === "skipped" ? "לא ביצע" : report.result === "na" ? "לא רלוונטי" : "";
            row.push(resultLabel);
            if (report.result === "skipped" || report.failed) {
              failedActivities.push(ai);
              failCountPerActivity[ai]++;
            } else if (report.result === "completed") {
              passCountPerActivity[ai]++;
            }
            for (let c = 0; c < scoreColCount; c++) {
              const gradeKey = scores[c]?.gradeKey ?? (`grade${c + 1}` as keyof typeof report);
              const g = report[gradeKey];
              row.push(g != null ? formatGradeDisplay(Number(g), scores[c]?.format) : "");
            }
          }
        }
        soldierRows.push({ values: row, failedActivities });
      }
    }

    // Summary row
    const summaryRow: string[] = ["סיכום", ""];
    for (let ai = 0; ai < platoonActivities.length; ai++) {
      const scores = scoresPerActivity[ai];
      const scoreColCount = Math.max(scores.length, 1);
      summaryRow.push(`${passCountPerActivity[ai]}/${failCountPerActivity[ai]}`);
      for (let c = 0; c < scoreColCount; c++) summaryRow.push("");
    }

    return {
      sheetTitle,
      colCounts,
      totalCols,
      soldierRows,
      summaryRowIndex: soldierRows.length + 2, // 0-indexed: row 0=names, row 1=labels, then soldiers
      valueRange: {
        range: `'${sheetTitle}'!A1`,
        values: [activityNameRow, scoreLabelRow, ...soldierRows.map((r) => r.values), summaryRow],
      },
    };
  });

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
  soldierRows: { values: string[]; failedActivities: number[] }[];
  summaryRowIndex: number;
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
        properties: { title: `דוח פעילויות - ${cycleName}`, locale: "iw" },
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

    // Merge activity name cells in row 1 (offset by 2 for name + squad columns)
    const mergeRequests: object[] = [];
    let colOffset = 2;
    for (const colCount of sd.colCounts) {
      if (colCount > 1) {
        mergeRequests.push({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: colOffset,
              endColumnIndex: colOffset + colCount,
            },
            mergeType: "MERGE_ALL",
          },
        });
      }
      colOffset += colCount;
    }

    // Red font for score cells of failed soldiers
    const redFontRequests: object[] = [];
    for (let ri = 0; ri < sd.soldierRows.length; ri++) {
      const sr = sd.soldierRows[ri];
      for (const ai of sr.failedActivities) {
        // Calculate column range for this activity's cells
        let startCol = 2;
        for (let j = 0; j < ai; j++) startCol += sd.colCounts[j];
        redFontRequests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: ri + 2, // skip 2 header rows
              endRowIndex: ri + 3,
              startColumnIndex: startCol,
              endColumnIndex: startCol + sd.colCounts[ai],
            },
            cell: {
              userEnteredFormat: {
                textFormat: { foregroundColorStyle: { rgbColor: { red: 0.8, green: 0.1, blue: 0.1 } } },
              },
            },
            fields: "userEnteredFormat.textFormat.foregroundColorStyle",
          },
        });
      }
    }

    return [
      ...mergeRequests,
      // Header rows formatting
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 2 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
              horizontalAlignment: "CENTER",
            },
          },
          fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
        },
      },
      // Summary row formatting
      {
        repeatCell: {
          range: { sheetId, startRowIndex: sd.summaryRowIndex, endRowIndex: sd.summaryRowIndex + 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
            },
          },
          fields: "userEnteredFormat(textFormat,backgroundColor)",
        },
      },
      // Freeze 2 header rows + 2 columns (name + squad)
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 2, frozenColumnCount: 2 },
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
            endIndex: sd.totalCols + 2,
          },
        },
      },
      ...redFontRequests,
    ];
  });
}
