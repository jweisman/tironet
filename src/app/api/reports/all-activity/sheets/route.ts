import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getReportScope } from "@/lib/api/report-scope";
import { refreshAccessToken } from "@/lib/reports/google-oauth";
import type { SessionUser } from "@/types";

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/reports/all-activity/sheets?cycleId=...
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

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
      platoon: { select: { name: true } },
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
    },
    include: {
      activityType: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });

  // Build activity ID → column index map
  const activityIds = activities.map((a) => a.id);
  const activityHeaders = activities.map(
    (a) => `${a.activityType.name} - ${a.name}`
  );

  const RESULT_LABELS: Record<string, string> = {
    passed: "עבר",
    failed: "נכשל",
    na: "לא רלוונטי",
  };

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

    // 2. Write values to each sheet
    const valueRanges = squads.map((squad, index) => {
      const sheetTitle = sheetProperties[index].properties.title;
      const headerRow = ["חייל", ...activityHeaders];
      const dataRows = squad.soldiers.map((soldier) => {
        const row = [`${soldier.familyName} ${soldier.givenName}`];
        for (const actId of activityIds) {
          const report = soldier.activityReports.find(
            (r) => r.activityId === actId
          );
          if (!report) {
            row.push("");
          } else {
            const grades = [report.grade1, report.grade2, report.grade3, report.grade4, report.grade5, report.grade6]
              .filter((g) => g != null)
              .map((g) => String(Number(g)));
            if (grades.length > 0) {
              row.push(grades.join(" / "));
            } else {
              row.push(RESULT_LABELS[report.result] || report.result);
            }
          }
        }
        return row;
      });

      return {
        range: `'${sheetTitle}'!A1`,
        values: [headerRow, ...dataRows],
      };
    });

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

    // 3. Apply formatting: bold headers, freeze first row + column, auto column widths
    const formatRequests = squads.flatMap((_, index) => [
      // Bold header row
      {
        repeatCell: {
          range: {
            sheetId: index,
            startRowIndex: 0,
            endRowIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
            },
          },
          fields: "userEnteredFormat(textFormat,backgroundColor)",
        },
      },
      // Freeze first row and first column
      {
        updateSheetProperties: {
          properties: {
            sheetId: index,
            gridProperties: {
              frozenRowCount: 1,
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
            sheetId: index,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: activityHeaders.length + 1,
          },
        },
      },
    ]);

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
