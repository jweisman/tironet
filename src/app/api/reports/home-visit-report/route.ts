import { NextRequest, NextResponse } from "next/server";
import { getPersonalFileScope } from "@/lib/api/personal-file-scope";
import { fetchHomeVisitReport } from "@/lib/reports/render-home-visit-report";

export type {
  HomeVisitReportData,
  HomeVisitPlatoon,
  HomeVisitSquad,
  HomeVisitSoldier,
  HomeVisitEntry,
} from "@/lib/reports/render-home-visit-report";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getPersonalFileScope(cycleId);
  if (error) return error;

  const data = await fetchHomeVisitReport(cycleId, scope!.platoonIds);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
