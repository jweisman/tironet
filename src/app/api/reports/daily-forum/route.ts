import { NextRequest, NextResponse } from "next/server";
import { getReportScope } from "@/lib/api/report-scope";
import { fetchDailyForum } from "@/lib/reports/render-daily-forum";

// Re-export types for the preview page
export type {
  DailyForumData,
  PlatoonForumSection,
  OpenRequestItem,
  CommanderEventItem,
  TodayActivityItem,
  TomorrowActivityItem,
  GapActivityItem,
  GapSoldier,
  AttendanceSummaryPlatoon,
} from "@/lib/reports/render-daily-forum";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getReportScope(cycleId);
  if (error) return error;

  // Daily forum is only for platoon and company commanders
  if (scope!.role !== "platoon_commander" && scope!.role !== "company_commander") {
    return NextResponse.json(
      { error: "Daily forum not available for this role" },
      { status: 403 },
    );
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;

  const data = await fetchDailyForum(cycleId, scope!.platoonIds, date);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
