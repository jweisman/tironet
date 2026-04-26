import { NextRequest, NextResponse } from "next/server";
import { getCalendarScope } from "@/lib/api/calendar-scope";
import { fetchCalendarData } from "@/lib/calendar/fetch";

export type { CalendarData, CalendarEvent, CalendarEventType, CalendarFilterCategory } from "@/lib/calendar/events";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getCalendarScope(cycleId);
  if (error) return error;

  const data = await fetchCalendarData(cycleId, scope!);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
