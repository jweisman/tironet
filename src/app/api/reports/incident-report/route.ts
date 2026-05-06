import { NextRequest, NextResponse } from "next/server";
import { getPersonalFileScope } from "@/lib/api/personal-file-scope";
import { fetchIncidentReport } from "@/lib/reports/render-incident-report";

export type {
  IncidentReportData,
  IncidentReportGroup,
  IncidentReportEntry,
} from "@/lib/reports/render-incident-report";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getPersonalFileScope(cycleId);
  if (error) return error;

  const groupBy = scope!.role === "company_commander" ? "platoon" : "squad";
  const data = await fetchIncidentReport(cycleId, scope!.platoonIds, groupBy);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
