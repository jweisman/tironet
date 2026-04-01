import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getReportScope } from "@/lib/api/report-scope";
import { refreshAccessToken } from "@/lib/reports/google-oauth";
import type { SessionUser } from "@/types";
import type { ScoreConfig } from "@/types/score-config";
import { getActiveScores } from "@/types/score-config";
import { formatGradeDisplay } from "@/lib/score-format";

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/reports/all-activity/sheets?cycleId=...
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const typesParam = request.nextUrl.searchParams.get("activityTypeIds");
  const activityTypeIds = typesParam ? typesParam.split(",").filter(Boolean) : undefined;

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
      // Refresh failed — user needs to re-authenticate
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
                status: "active",
                platoonId: { in: scope!.platoonIds },
                ...(activityTypeIds?.length ? { activityTypeId: { in: activityTypeIds } } : {}),
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

  // Get all activities for the columns
  const activities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: scope!.platoonIds },
      status: "active",
      ...(activityTypeIds?.length ? { activityTypeId: { in: activityTypeIds } } : {}),
    },
    include: {
      activityType: {
        select: {
          name: true,
          scoreConfig: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });

  function getActivityScores(a: typeof activities[number]) {
    return getActiveScores(a.activityType.scoreConfig as ScoreConfig | null);
  }

  try {
    // 1. Create spreadsheet with one sheet per squad
    const sheetProperties = squads.map((squad, index) => ({
      properties: {
        sheetId: index,
        title: `${squad.platoon.name} - ${squad.name}`,
        rightToLeft: true,
      },
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
          properties: {
            title: `דוח פעילויות - ${cycle.name}`,
            locale: "iw",
          },
          sheets: sheetProperties,
        }),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Sheets API create error:", errText);
      if (createRes.status === 401) {
        // Token revoked
        await prisma.googleExportToken.delete({
          where: { userId: sessionUser.id },
        });
        return NextResponse.json({
          needsAuth: true,
          authUrl: `/api/reports/google/auth?cycleId=${cycleId}`,
        });
      }
      return NextResponse.json(
        { error: "Failed to create spreadsheet" },
        { status: 500 }
      );
    }

    const spreadsheet = await createRes.json();
    const spreadsheetId = spreadsheet.spreadsheetId;

    // 2. Build two header rows + data rows (per squad, filtered to platoon's activities)
    const squadSheetData = squads.map((squad, index) => {
      const sheetTitle = sheetProperties[index].properties.title;
      const squadActivities = activities.filter((a) => a.platoonId === squad.platoon.id);
      const scoresPerActivity = squadActivities.map((a) => getActivityScores(a));
      const colCounts = scoresPerActivity.map((scores) => Math.max(scores.length, 1));
      const totalCols = colCounts.reduce((a, b) => a + b, 0);

      // Row 1: activity names (merged across score columns)
      const activityNameRow: string[] = [""];
      for (let ai = 0; ai < squadActivities.length; ai++) {
        const a = squadActivities[ai];
        activityNameRow.push(`${a.activityType.name} - ${a.name}`);
        for (let c = 1; c < colCounts[ai]; c++) activityNameRow.push("");
      }

      // Row 2: score labels
      const scoreLabelRow: string[] = ["חייל"];
      for (let ai = 0; ai < squadActivities.length; ai++) {
        const scores = scoresPerActivity[ai];
        if (scores.length <= 1) {
          scoreLabelRow.push(scores[0]?.label ?? "ציון");
        } else {
          for (const s of scores) scoreLabelRow.push(s.label);
        }
      }

      // Data rows
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
        sheetIndex: index,
        colCounts,
        totalCols,
        valueRange: {
          range: `'${sheetTitle}'!A1`,
          values: [activityNameRow, scoreLabelRow, ...dataRows],
        },
      };
    });

    const valueRanges = squadSheetData.map((s) => s.valueRange);

    const batchUpdateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: valueRanges,
        }),
      }
    );

    if (!batchUpdateRes.ok) {
      console.error(
        "Sheets API values.batchUpdate error:",
        await batchUpdateRes.text()
      );
    }

    // 3. Apply formatting: bold headers, freeze rows + column, merges, auto column widths
    const formatRequests = squadSheetData.flatMap((sd) => {
      // Merge cells for activity name row (row 0) — one merge per activity group
      const mergeRequests: object[] = [];
      let colOffset = 1; // skip soldier name column
      for (const colCount of sd.colCounts) {
        if (colCount > 1) {
          mergeRequests.push({
            mergeCells: {
              range: {
                sheetId: sd.sheetIndex,
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
        // Bold + background on both header rows
        {
          repeatCell: {
            range: {
              sheetId: sd.sheetIndex,
              startRowIndex: 0,
              endRowIndex: 2,
            },
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
        // Freeze first 2 rows and first column
        {
          updateSheetProperties: {
            properties: {
              sheetId: sd.sheetIndex,
              gridProperties: {
                frozenRowCount: 2,
                frozenColumnCount: 1,
              },
            },
            fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
          },
        },
        // Auto-resize columns
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: sd.sheetIndex,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: sd.totalCols + 1,
            },
          },
        },
      ];
    });

    const formatRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests: formatRequests }),
      }
    );

    if (!formatRes.ok) {
      console.error(
        "Sheets API batchUpdate error:",
        await formatRes.text()
      );
    }

    return NextResponse.json({
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    });
  } catch (err) {
    console.error("Sheets generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate spreadsheet" },
      { status: 500 }
    );
  }
}
