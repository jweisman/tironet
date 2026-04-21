import { NextRequest, NextResponse } from "next/server";
import { getReportScope } from "@/lib/api/report-scope";
import { fetchAttendance } from "@/lib/reports/render-attendance";

// Re-export types for the preview page
export type {
  AttendanceData,
  AttendancePlatoon,
  AttendanceSquad,
  AttendanceSoldier,
  AttendanceStatus,
} from "@/lib/reports/render-attendance";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getReportScope(cycleId);
  if (error) return error;

  if (scope!.role !== "platoon_commander" && scope!.role !== "company_commander") {
    return NextResponse.json(
      { error: "Attendance report not available for this role" },
      { status: 403 },
    );
  }

  const data = await fetchAttendance(cycleId, scope!.platoonIds);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
