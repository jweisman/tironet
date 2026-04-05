import { NextRequest, NextResponse } from "next/server";
import { getReportScope } from "@/lib/api/report-scope";
import { fetchActivitySummary } from "@/lib/reports/render-activity-summary";
import { dateRangeToAfterDate } from "@/lib/reports/date-range";

// Re-export types for the preview page
export type { ActivitySummaryRow, ActivitySummaryItem, ActivitySummaryData } from "@/lib/reports/render-activity-summary";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getReportScope(cycleId);
  if (error) return error;

  const typesParam = request.nextUrl.searchParams.get("activityTypeIds");
  const activityTypeIds = typesParam ? typesParam.split(",").filter(Boolean) : undefined;
  const afterDate = dateRangeToAfterDate(request.nextUrl.searchParams.get("dateRange"));

  const data = await fetchActivitySummary(cycleId, scope!.platoonIds, activityTypeIds, afterDate);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
