import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reports/render-attendance", () => ({
  fetchAttendance: vi.fn().mockResolvedValue({ platoons: [] }),
  STATUS_LABELS: { present: "נוכח", leave: "יציאה", medical_appointment: "תור רפואי", sick_day: "יום מחלה", inactive: "לא פעיל" },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    cycle: { findUnique: vi.fn() },
    platoon: { findMany: vi.fn() },
    request: { findMany: vi.fn() },
    activity: { findMany: vi.fn() },
  },
}));

import { fetchDailyForum, getIsraelDates, renderDailyForumHtml } from "../render-daily-forum";
import { prisma } from "@/lib/db/prisma";

const mockCycleFindUnique = vi.mocked(prisma.cycle.findUnique);
const mockPlatoonFindMany = vi.mocked(prisma.platoon.findMany);
const mockRequestFindMany = vi.mocked(prisma.request.findMany);
const mockActivityFindMany = vi.mocked(prisma.activity.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getIsraelDates
// ---------------------------------------------------------------------------

describe("getIsraelDates", () => {
  it("computes tomorrow from a given date string", () => {
    const result = getIsraelDates("2026-04-07");
    expect(result.today).toBe("2026-04-07");
    expect(result.tomorrow).toBe("2026-04-08");
  });

  it("handles month boundaries", () => {
    const result = getIsraelDates("2026-01-31");
    expect(result.tomorrow).toBe("2026-02-01");
  });

  it("handles year boundaries", () => {
    const result = getIsraelDates("2025-12-31");
    expect(result.tomorrow).toBe("2026-01-01");
  });
});

// ---------------------------------------------------------------------------
// fetchDailyForum
// ---------------------------------------------------------------------------

describe("fetchDailyForum", () => {
  const basePlatoon = {
    id: "p1",
    name: "Platoon 1",
    sortOrder: 1,
    company: { name: "Company A" },
    squads: [
      {
        id: "sq1",
        name: "Squad 1",
        sortOrder: 1,
        soldiers: [
          { id: "s1", givenName: "Avi", familyName: "Cohen" },
          { id: "s2", givenName: "Dan", familyName: "Levy" },
        ],
      },
    ],
  };

  function setupBaseMocks() {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([basePlatoon] as never);
    mockRequestFindMany.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([]);
  }

  it("returns null when cycle not found", async () => {
    mockCycleFindUnique.mockResolvedValue(null);
    const result = await fetchDailyForum("cycle-x", ["p1"], "2026-04-07");
    expect(result).toBeNull();
  });

  it("returns empty sections when no data exists", async () => {
    setupBaseMocks();
    const result = await fetchDailyForum("cycle-1", ["p1"], "2026-04-07");
    expect(result).not.toBeNull();
    expect(result!.cycleName).toBe("Test Cycle");
    expect(result!.date).toBe("2026-04-07");
    expect(result!.tomorrowDate).toBe("2026-04-08");
    expect(result!.platoons).toHaveLength(1);
    expect(result!.platoons[0].openRequests.medical).toHaveLength(0);
    expect(result!.platoons[0].openRequests.hardship).toHaveLength(0);
    expect(result!.platoons[0].openRequests.leave).toHaveLength(0);
    expect(result!.platoons[0].activeRequests.medical).toHaveLength(0);
    expect(result!.platoons[0].activeRequests.leave).toHaveLength(0);
    expect(result!.platoons[0].todayActivities).toHaveLength(0);
    expect(result!.platoons[0].tomorrowActivities).toHaveLength(0);
    expect(result!.platoons[0].gaps).toHaveLength(0);
  });

  it("groups open requests by type", async () => {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([basePlatoon] as never);
    // First call = open requests, second call = active requests
    mockRequestFindMany.mockResolvedValueOnce([
      {
        id: "r1",
        type: "medical",
        status: "open",
        assignedRole: "platoon_commander",
        description: "Headache",
        createdAt: new Date("2026-04-07T10:00:00Z"),
        place: null,
        departureAt: null,
        returnAt: null,
        transportation: null,
        paramedicDate: null,
        medicalAppointments: null,
        sickDays: null,
        specialConditions: null,
        soldier: {
          givenName: "Avi",
          familyName: "Cohen",
          squad: { name: "Squad 1", platoon: { id: "p1" } },
        },
        actions: [],
      },
      {
        id: "r2",
        type: "leave",
        status: "open",
        assignedRole: "company_commander",
        description: "Family event",
        createdAt: new Date("2026-04-07T09:00:00Z"),
        place: "Tel Aviv",
        departureAt: new Date("2026-04-10T08:00:00Z"),
        returnAt: new Date("2026-04-12T20:00:00Z"),
        transportation: "shuttle",
        paramedicDate: null,
        medicalAppointments: null,
        sickDays: null,
        specialConditions: null,
        soldier: {
          givenName: "Dan",
          familyName: "Levy",
          squad: { name: "Squad 1", platoon: { id: "p1" } },
        },
        actions: [],
      },
    ] as never);
    mockRequestFindMany.mockResolvedValueOnce([]); // active requests
    mockActivityFindMany.mockResolvedValue([]);

    const result = await fetchDailyForum("cycle-1", ["p1"], "2026-04-07");
    expect(result!.platoons[0].openRequests.medical).toHaveLength(1);
    expect(result!.platoons[0].openRequests.leave).toHaveLength(1);
    expect(result!.platoons[0].openRequests.hardship).toHaveLength(0);
    expect(result!.platoons[0].openRequests.medical[0].soldierName).toBe("Cohen Avi");
    expect(result!.platoons[0].openRequests.leave[0].place).toBe("Tel Aviv");
  });

  it("includes active approved requests (leave + medical) but not hardship", async () => {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([basePlatoon] as never);
    mockRequestFindMany.mockResolvedValueOnce([]); // open requests
    mockRequestFindMany.mockResolvedValueOnce([
      {
        id: "r-leave",
        type: "leave",
        status: "approved",
        assignedRole: null,
        description: "Weekend leave",
        createdAt: new Date("2026-04-07T10:00:00Z"),
        place: "Home",
        departureAt: new Date("2026-04-10T08:00:00Z"),
        returnAt: new Date("2026-04-12T20:00:00Z"),
        transportation: "private",
        paramedicDate: null,
        medicalAppointments: null,
        sickDays: null,
        specialConditions: null,
        soldier: {
          givenName: "Avi",
          familyName: "Cohen",
          squad: { name: "Squad 1", platoon: { id: "p1" } },
        },
        actions: [],
      },
      {
        id: "r-medical",
        type: "medical",
        status: "approved",
        assignedRole: null,
        description: "Checkup",
        createdAt: new Date("2026-04-07T09:00:00Z"),
        place: null,
        departureAt: null,
        returnAt: null,
        transportation: null,
        paramedicDate: null,
        medicalAppointments: JSON.stringify([{ id: "a1", date: "2026-12-01", place: "Hospital", type: "Checkup" }]),
        sickDays: null,
        specialConditions: null,
        soldier: {
          givenName: "Dan",
          familyName: "Levy",
          squad: { name: "Squad 1", platoon: { id: "p1" } },
        },
        actions: [],
      },
      {
        id: "r-leave-past",
        type: "leave",
        status: "approved",
        assignedRole: null,
        description: "Past leave",
        createdAt: new Date("2026-03-01T10:00:00Z"),
        place: "Home",
        departureAt: new Date("2026-03-05T08:00:00Z"),
        returnAt: new Date("2026-03-07T20:00:00Z"),
        transportation: "private",
        paramedicDate: null,
        medicalAppointments: null,
        sickDays: null,
        specialConditions: null,
        soldier: {
          givenName: "Avi",
          familyName: "Cohen",
          squad: { name: "Squad 1", platoon: { id: "p1" } },
        },
        actions: [],
      },
    ] as never);
    mockActivityFindMany.mockResolvedValue([]);

    const result = await fetchDailyForum("cycle-1", ["p1"], "2026-04-07");
    // Active leave with future dates
    expect(result!.platoons[0].activeRequests.leave).toHaveLength(1);
    expect(result!.platoons[0].activeRequests.leave[0].soldierName).toBe("Cohen Avi");
    // Active medical with future appointment
    expect(result!.platoons[0].activeRequests.medical).toHaveLength(1);
    expect(result!.platoons[0].activeRequests.medical[0].soldierName).toBe("Levy Dan");
  });

  it("computes pass/fail/na counts for today activities", async () => {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([basePlatoon] as never);
    mockRequestFindMany.mockResolvedValue([]);

    // First call = today's activities, second = tomorrow's, third = gap activities
    let callCount = 0;
    mockActivityFindMany.mockImplementation((() => {
      callCount++;
      if (callCount === 1) {
        // Today's activity
        return [
          {
            id: "a1",
            name: "Shooting",
            platoonId: "p1",
            date: new Date("2026-04-07T00:00:00Z"),
            status: "active",
            isRequired: true,
            activityType: { name: "Qualification", scoreConfig: null },
            reports: [
              { soldierId: "s1", result: "completed", soldier: { status: "active", squad: { name: "Squad 1", platoon: { id: "p1", name: "Platoon 1", company: { name: "Company A" } } } } },
              { soldierId: "s2", result: "skipped", soldier: { status: "active", squad: { name: "Squad 1", platoon: { id: "p1", name: "Platoon 1", company: { name: "Company A" } } } } },
            ],
          },
        ];
      }
      return [];
    }) as never);

    const result = await fetchDailyForum("cycle-1", ["p1"], "2026-04-07");
    const todayActs = result!.platoons[0].todayActivities;
    expect(todayActs).toHaveLength(1);
    expect(todayActs[0].passedCount).toBe(1);
    expect(todayActs[0].failedCount).toBe(1);
    expect(todayActs[0].naCount).toBe(0);
    expect(todayActs[0].totalSoldiers).toBe(2);
  });

  it("identifies gaps correctly (missing, skipped, and failed)", async () => {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([{
      ...basePlatoon,
      squads: [
        {
          id: "sq1",
          name: "Squad 1",
          sortOrder: 1,
          soldiers: [
            { id: "s1", givenName: "Avi", familyName: "Cohen" },
            { id: "s2", givenName: "Dan", familyName: "Levy" },
            { id: "s3", givenName: "Yael", familyName: "Ben" },
          ],
        },
      ],
    }] as never);
    mockRequestFindMany.mockResolvedValue([]);

    let callCount = 0;
    mockActivityFindMany.mockImplementation((() => {
      callCount++;
      if (callCount === 3) {
        // Gap activities (past required activities)
        return [
          {
            id: "a-past",
            name: "Past Activity",
            platoonId: "p1",
            date: new Date("2026-04-05T00:00:00Z"),
            status: "active",
            isRequired: true,
            activityType: { name: "Drill" },
            reports: [
              // s1 has a skipped report, s2 has no report (missing), s3 completed but failed
              { soldierId: "s1", result: "skipped", failed: false },
              { soldierId: "s3", result: "completed", failed: true },
            ],
          },
        ];
      }
      return [];
    }) as never);

    const result = await fetchDailyForum("cycle-1", ["p1"], "2026-04-07");
    const gaps = result!.platoons[0].gaps;
    expect(gaps).toHaveLength(1);
    expect(gaps[0].name).toBe("Past Activity");
    expect(gaps[0].soldiers).toHaveLength(3);

    const skipped = gaps[0].soldiers.find((s) => s.result === "skipped");
    const failed = gaps[0].soldiers.find((s) => s.result === "failed");
    const missing = gaps[0].soldiers.find((s) => s.result === "missing");
    expect(skipped).toBeDefined();
    expect(skipped!.name).toBe("Cohen Avi");
    expect(failed).toBeDefined();
    expect(failed!.name).toBe("Ben Yael");
    expect(missing).toBeDefined();
    expect(missing!.name).toBe("Levy Dan");
  });

  it("excludes activities with no gaps", async () => {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([basePlatoon] as never);
    mockRequestFindMany.mockResolvedValue([]);

    let callCount = 0;
    mockActivityFindMany.mockImplementation((() => {
      callCount++;
      if (callCount === 3) {
        return [
          {
            id: "a-past",
            name: "Completed Activity",
            platoonId: "p1",
            date: new Date("2026-04-05T00:00:00Z"),
            status: "active",
            isRequired: true,
            activityType: { name: "Drill" },
            reports: [
              { soldierId: "s1", result: "completed", failed: false },
              { soldierId: "s2", result: "completed", failed: false },
            ],
          },
        ];
      }
      return [];
    }) as never);

    const result = await fetchDailyForum("cycle-1", ["p1"], "2026-04-07");
    expect(result!.platoons[0].gaps).toHaveLength(0);
  });

  it("handles multiple platoons", async () => {
    mockCycleFindUnique.mockResolvedValue({ id: "cycle-1", name: "Test Cycle" } as never);
    mockPlatoonFindMany.mockResolvedValue([
      { ...basePlatoon, id: "p1", name: "Platoon 1" },
      {
        id: "p2",
        name: "Platoon 2",
        sortOrder: 2,
        company: { name: "Company A" },
        squads: [],
      },
    ] as never);
    mockRequestFindMany.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([]);

    const result = await fetchDailyForum("cycle-1", ["p1", "p2"], "2026-04-07");
    expect(result!.platoons).toHaveLength(2);
    expect(result!.platoons[0].platoonName).toBe("Platoon 1");
    expect(result!.platoons[1].platoonName).toBe("Platoon 2");
  });
});

// ---------------------------------------------------------------------------
// renderDailyForumHtml
// ---------------------------------------------------------------------------

describe("renderDailyForumHtml", () => {
  const emptyData = {
    cycleName: "Test Cycle",
    date: "2026-04-07",
    tomorrowDate: "2026-04-08",
    platoons: [
      {
        platoonId: "p1",
        platoonName: "Platoon 1",
        companyName: "Company A",
        openRequests: { medical: [], hardship: [], leave: [] },
        activeRequests: { medical: [], leave: [] },
        todayActivities: [],
        tomorrowActivities: [],
        gaps: [],
      },
    ],
    attendance: [],
  };

  it("contains expected Hebrew headers", () => {
    const html = renderDailyForumHtml(emptyData);
    expect(html).toContain("דוח פורום יומי");
    expect(html).toContain("בקשות ממתינות");
    expect(html).toContain("בקשות פעילות");
    expect(html).toContain("הספקים");
    expect(html).toContain("פעילויות היום");
    expect(html).toContain("פעילויות מחר");
    expect(html).toContain("תכנון מול ביצוע");
    expect(html).toContain("פערים");
  });

  it("renders RTL direction", () => {
    const html = renderDailyForumHtml(emptyData);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="he"');
  });

  it("includes platoon subheaders for multi-platoon data", () => {
    const multiPlatoonData = {
      ...emptyData,
      platoons: [
        {
          ...emptyData.platoons[0],
          gaps: [{ id: "g1", name: "Activity 1", activityTypeName: "Type", date: "2026-04-20", soldiers: [{ name: "Soldier", result: "missing" as const }] }],
        },
        {
          ...emptyData.platoons[0],
          platoonId: "p2",
          platoonName: "Platoon 2",
          gaps: [{ id: "g2", name: "Activity 2", activityTypeName: "Type", date: "2026-04-20", soldiers: [{ name: "Soldier 2", result: "skipped" as const }] }],
        },
      ],
    };
    const html = renderDailyForumHtml(multiPlatoonData);
    expect(html).toContain('class="platoon-subheader"');
  });

  it("does not include platoon subheaders for single platoon", () => {
    const html = renderDailyForumHtml(emptyData);
    expect(html).not.toContain('class="platoon-subheader"');
  });

  it("renders gap soldier names", () => {
    const dataWithGaps = {
      ...emptyData,
      platoons: [
        {
          ...emptyData.platoons[0],
          gaps: [
            {
              id: "g1",
              name: "Shooting",
              activityTypeName: "Qualification",
              date: "2026-04-05",
              soldiers: [
                { name: "Cohen Avi", result: "skipped" as const },
                { name: "Levy Dan", result: "missing" as const },
                { name: "Ben Yael", result: "failed" as const },
              ],
            },
          ],
        },
      ],
    };
    const html = renderDailyForumHtml(dataWithGaps);
    expect(html).toContain("Cohen Avi");
    expect(html).toContain("Levy Dan");
    expect(html).toContain("Ben Yael");
    expect(html).toContain("לא השתתף"); // skipped label
    expect(html).toContain("נכשל"); // failed label
    expect(html).toContain("חסר"); // missing label
  });

  it("renders pie chart SVG for today activities", () => {
    const dataWithActivities = {
      ...emptyData,
      platoons: [
        {
          ...emptyData.platoons[0],
          todayActivities: [
            {
              id: "a1",
              name: "Test",
              activityTypeName: "Drill",
              date: "2026-04-07",
              scoreLabels: [],
              scoreFormats: [] as ("number" | "time")[],
              passedCount: 5,
              failedCount: 2,
              naCount: 1,
              totalSoldiers: 8,
              rows: [],
            },
          ],
        },
      ],
    };
    const html = renderDailyForumHtml(dataWithActivities);
    expect(html).toContain("<svg");
    expect(html).toContain("השתתף (5)");
    expect(html).toContain("לא השתתף (2)");
  });

  it("shows empty state messages", () => {
    const html = renderDailyForumHtml(emptyData);
    expect(html).toContain("אין בקשות ממתינות");
    expect(html).toContain("אין בקשות פעילות");
    expect(html).toContain("אין פעילויות להיום");
    expect(html).toContain("אין פעילויות למחר");
    expect(html).toContain("אין פערים");
  });
});
