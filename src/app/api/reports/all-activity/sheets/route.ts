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
                ...(afterDate ? { date: { gte: afterDate } } : {}),
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
      ...(afterDate ? { date: { gte: afterDate } } : {}),
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

  // Build sheet titles and data (shared between create and update flows)
  const sheetTitles = squads.map(
    (squad) => `${squad.platoon.name} - ${squad.name}`
  );

  const squadSheetData = squads.map((squad, index) => {
    const sheetTitle = sheetTitles[index];
    const squadActivities = activities.filter((a) => a.platoonId === squad.platoon.id);
    const scoresPerActivity = squadActivities.map((a) => getActivityScores(a));
    const colCounts = scoresPerActivity.map((scores) => Math.max(scores.length, 1));
    const totalCols = colCounts.reduce((a, b) => a + b, 0);

    const activityNameRow: string[] = [""];
    for (let ai = 0; ai < squadActivities.length; ai++) {
      const a = squadActivities[ai];
      activityNameRow.push(`${a.activityType.name} - ${a.name}`);
      for (let c = 1; c < colCounts[ai]; c++) activityNameRow.push("");
    }

    const scoreLabelRow: string[] = ["חייל"];
    for (let ai = 0; ai < squadActivities.length; ai++) {
      const scores = scoresPerActivity[ai];
      if (scores.length <= 1) {
        scoreLabelRow.push(scores[0]?.label ?? "ציון");
      } else {
        for (const s of scores) scoreLabelRow.push(s.label);
      }
    }

    const dataRows = squad.soldiers.map((soldier) => {
      const row = [`${soldier.familyName} ${soldier.givenName}`];
      for (let ai = 0; ai < squadActivities.length; ai++) {
        const report = soldier.activityReports.find(
          (r) => r.activityId === squadActivities[ai].id
        );
        const scores = scoresPerActivity[ai];
        const colCount = colCounts[ai];
        if (!report) {
          for (let c = 0; c < colCount; c++) row.push("");
        } else {
          for (let c = 0; c < colCount; c++) {
            const gradeKey = scores[c]?.gradeKey ?? (`grade${c + 1}` as keyof typeof report);
            const g = report[gradeKey];
            row.push(g != null ? formatGradeDisplay(Number(g), scores[c]?.format) : "");
          }
        }
      }
      return row;
    });

    return {
      sheetTitle,
      colCounts,
      totalCols,
      valueRange: {
        range: `'${sheetTitle}'!A1`,
        values: [activityNameRow, scoreLabelRow, ...dataRows],
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

    const mergeRequests: object[] = [];
    let colOffset = 1;
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

    return [
      ...mergeRequests,
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
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 },
          },
          fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: sd.totalCols + 1,
          },
        },
      },
    ];
  });
}
