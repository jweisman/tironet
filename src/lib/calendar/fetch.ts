import { prisma } from "@/lib/db/prisma";
import {
  buildCalendarEvents,
  getThreeMonthRange,
  type CalendarData,
  type CalendarEventType,
  type RawActivity,
  type RawRequest,
  type RawCommanderEventData,
} from "@/lib/calendar/events";
import type { CalendarScope } from "@/lib/api/calendar-scope";

// ---------------------------------------------------------------------------
// Role → visible event types
// ---------------------------------------------------------------------------

function getVisibleTypes(role: CalendarScope["role"]): CalendarEventType[] {
  switch (role) {
    case "instructor":
      return ["activity"];
    case "company_medic":
      return ["medical_appointment", "sick_day"];
    case "squad_commander":
      return ["activity", "leave", "medical_appointment", "sick_day"];
    default:
      // platoon_commander, company_commander
      return ["activity", "leave", "medical_appointment", "sick_day", "commander_event"];
  }
}

// ---------------------------------------------------------------------------
// Fetch calendar data from Prisma
// ---------------------------------------------------------------------------

export async function fetchCalendarData(
  cycleId: string,
  scope: CalendarScope,
): Promise<CalendarData | null> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) return null;

  const visibleTypes = getVisibleTypes(scope.role);
  const { startDate, endDate } = getThreeMonthRange();

  // Fetch platoons for legend/filtering
  const platoons = await prisma.platoon.findMany({
    where: { id: { in: scope.platoonIds } },
    select: { id: true, name: true, company: { select: { name: true } } },
    orderBy: { sortOrder: "asc" },
  });

  const companyName = platoons[0]?.company?.name ?? null;

  // Fetch activities — squad commanders see their platoon's activities (same as activities page)
  let rawActivities: RawActivity[] = [];
  if (visibleTypes.includes("activity")) {
    const activities = await prisma.activity.findMany({
      where: {
        cycleId,
        platoonId: { in: scope.platoonIds },
        status: "active",
        date: { gte: new Date(startDate), lte: new Date(endDate + "T23:59:59.999Z") },
      },
      select: {
        id: true,
        name: true,
        date: true,
        platoonId: true,
        platoon: { select: { name: true } },
        activityType: { select: { icon: true } },
      },
      orderBy: { date: "asc" },
    });
    rawActivities = activities.map((a) => ({
      id: a.id,
      name: a.name,
      date: a.date.toISOString().split("T")[0],
      platoonId: a.platoonId,
      platoonName: a.platoon.name,
      activityTypeIcon: a.activityType.icon,
    }));
  }

  // Fetch requests (leave + medical)
  // Squad commanders see only their squad's soldiers' requests
  let rawRequests: RawRequest[] = [];
  const requestTypes: string[] = [];
  if (visibleTypes.includes("leave")) requestTypes.push("leave");
  if (visibleTypes.includes("medical_appointment") || visibleTypes.includes("sick_day")) {
    requestTypes.push("medical");
  }

  if (requestTypes.length > 0) {
    const soldierFilter = scope.squadId
      ? { squadId: scope.squadId }
      : { squad: { platoon: { id: { in: scope.platoonIds } } } };

    const requests = await prisma.request.findMany({
      where: {
        cycleId,
        type: { in: requestTypes as ("leave" | "medical")[] },
        status: "approved",
        soldier: soldierFilter,
      },
      select: {
        id: true,
        type: true,
        status: true,
        departureAt: true,
        returnAt: true,
        medicalAppointments: true,
        sickDays: true,
        soldier: {
          select: {
            familyName: true,
            givenName: true,
            squad: {
              select: {
                platoon: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    rawRequests = requests.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      departureAt: r.departureAt?.toISOString() ?? null,
      returnAt: r.returnAt?.toISOString() ?? null,
      medicalAppointments: r.medicalAppointments,
      sickDays: r.sickDays,
      soldierName: `${r.soldier.familyName} ${r.soldier.givenName}`,
      platoonId: r.soldier.squad.platoon.id,
      platoonName: r.soldier.squad.platoon.name,
    }));
  }

  // Fetch commander events (platoon/company commanders only)
  let rawCommanderEvents: RawCommanderEventData[] = [];
  if (visibleTypes.includes("commander_event")) {
    const cmdrEvents = await prisma.commanderEvent.findMany({
      where: {
        cycleId,
        platoonId: { in: scope.platoonIds },
        startDate: { lte: new Date(endDate + "T23:59:59.999Z") },
        endDate: { gte: new Date(startDate) },
      },
      select: {
        id: true,
        userId: true,
        userName: true,
        type: true,
        startDate: true,
        endDate: true,
        platoonId: true,
        platoon: { select: { name: true } },
      },
    });
    rawCommanderEvents = cmdrEvents.map((ce) => ({
      id: ce.id,
      userId: ce.userId,
      userName: ce.userName,
      type: ce.type,
      startDate: ce.startDate.toISOString().split("T")[0],
      endDate: ce.endDate.toISOString().split("T")[0],
      platoonId: ce.platoonId,
      platoonName: ce.platoon.name,
    }));
  }

  const events = buildCalendarEvents(rawActivities, rawRequests, startDate, endDate, rawCommanderEvents);

  return {
    cycleName: cycle.name,
    companyName,
    events,
    platoons: platoons.map((p) => ({ id: p.id, name: p.name })),
    visibleTypes,
  };
}
