import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import type { SessionUser } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as SessionUser;
  const reportType = request.nextUrl.searchParams.get("reportType");
  if (!reportType) {
    return NextResponse.json({ error: "reportType is required" }, { status: 400 });
  }

  const exportDefault = await prisma.reportExportDefault.findUnique({
    where: { userId_reportType: { userId: user.id, reportType } },
  });

  if (!exportDefault) {
    return NextResponse.json({ spreadsheetId: null, spreadsheetName: null });
  }

  return NextResponse.json({
    spreadsheetId: exportDefault.spreadsheetId,
    spreadsheetName: exportDefault.spreadsheetName,
  });
}
