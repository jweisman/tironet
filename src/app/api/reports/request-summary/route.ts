import { NextRequest, NextResponse } from "next/server";
import { getReportScope } from "@/lib/api/report-scope";
import { fetchRequestSummary } from "@/lib/reports/render-request-summary";
import { dateRangeToAfterDate } from "@/lib/reports/date-range";

export type { RequestSummaryItem, RequestSummaryGroup, RequestSummaryData } from "@/lib/reports/render-request-summary";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getReportScope(cycleId);
  if (error) return error;

  const typesParam = request.nextUrl.searchParams.get("requestTypes");
  const requestTypes = typesParam ? typesParam.split(",").filter(Boolean) : undefined;
  const afterDate = dateRangeToAfterDate(request.nextUrl.searchParams.get("dateRange"));

  const data = await fetchRequestSummary(cycleId, scope!.platoonIds, requestTypes, afterDate);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
