import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    cycle: { findUnique: vi.fn() },
    soldier: { findMany: vi.fn() },
  },
}));

import {
  fetchHomeVisitReport,
  renderHomeVisitReportHtml,
  type HomeVisitReportData,
} from "../render-home-visit-report";
import { prisma } from "@/lib/db/prisma";

const mockCycle = vi.mocked(prisma.cycle.findUnique);
const mockSoldier = vi.mocked(prisma.soldier.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeSoldier(overrides: Partial<{
  id: string;
  givenName: string;
  familyName: string;
  squadId: string;
  squadName: string;
  squadSortOrder: number;
  platoonId: string;
  platoonName: string;
  platoonSortOrder: number;
  companyName: string;
  companySortOrder: number;
  homeVisits: Array<{ date: Date; status: string; notes: string | null; createdByName: string }>;
}> = {}) {
  return {
    id: overrides.id ?? "s1",
    givenName: overrides.givenName ?? "Avi",
    familyName: overrides.familyName ?? "Cohen",
    squad: {
      id: overrides.squadId ?? "sq1",
      name: overrides.squadName ?? "Squad 1",
      sortOrder: overrides.squadSortOrder ?? 1,
      platoon: {
        id: overrides.platoonId ?? "p1",
        name: overrides.platoonName ?? "Platoon 1",
        sortOrder: overrides.platoonSortOrder ?? 1,
        company: {
          name: overrides.companyName ?? "Company A",
          sortOrder: overrides.companySortOrder ?? 1,
        },
      },
    },
    homeVisits: overrides.homeVisits ?? [],
  };
}

// ---------------------------------------------------------------------------
// fetchHomeVisitReport
// ---------------------------------------------------------------------------

describe("fetchHomeVisitReport", () => {
  it("returns null when cycle does not exist", async () => {
    mockCycle.mockResolvedValueOnce(null);
    const result = await fetchHomeVisitReport("c1", ["p1"]);
    expect(result).toBeNull();
  });

  it("groups soldiers by platoon and squad", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({ id: "s1", familyName: "Cohen", givenName: "Avi" }),
      makeSoldier({ id: "s2", familyName: "Levy", givenName: "Dan" }),
      makeSoldier({
        id: "s3",
        familyName: "Mizrahi",
        givenName: "Eli",
        squadId: "sq2",
        squadName: "Squad 2",
        squadSortOrder: 2,
      }),
    ] as never);

    const result = await fetchHomeVisitReport("c1", ["p1"]);
    expect(result).not.toBeNull();
    expect(result!.cycleName).toBe("Cycle 2026");
    expect(result!.platoons).toHaveLength(1);
    expect(result!.platoons[0].squads).toHaveLength(2);
    expect(result!.platoons[0].squads[0].soldiers.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(result!.platoons[0].squads[1].soldiers.map((s) => s.id)).toEqual(["s3"]);
  });

  it("attaches home visits to the matching soldier", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({
        id: "s1",
        homeVisits: [
          {
            date: new Date("2026-04-01"),
            status: "in_order",
            notes: "All good",
            createdByName: "Cmdr",
          },
          {
            date: new Date("2026-03-15"),
            status: "deficiencies",
            notes: null,
            createdByName: "Cmdr",
          },
        ],
      }),
      makeSoldier({ id: "s2", familyName: "Levy", givenName: "Dan" }),
    ] as never);

    const result = await fetchHomeVisitReport("c1", ["p1"]);
    const soldiers = result!.platoons[0].squads[0].soldiers;
    expect(soldiers[0].visits).toHaveLength(2);
    expect(soldiers[0].visits[0].date).toBe("2026-04-01");
    expect(soldiers[0].visits[0].status).toBe("in_order");
    expect(soldiers[0].visits[0].notes).toBe("All good");
    expect(soldiers[0].visits[1].notes).toBeNull();
    expect(soldiers[1].visits).toHaveLength(0);
  });

  it("counts visited soldiers per platoon and totals", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({
        id: "s1",
        homeVisits: [
          {
            date: new Date("2026-04-01"),
            status: "in_order",
            notes: null,
            createdByName: "Cmdr",
          },
        ],
      }),
      makeSoldier({ id: "s2", familyName: "Levy", givenName: "Dan" }),
      makeSoldier({
        id: "s3",
        familyName: "Mizrahi",
        givenName: "Eli",
        platoonId: "p2",
        platoonName: "Platoon 2",
        platoonSortOrder: 2,
        squadId: "sq3",
        squadName: "Squad 3",
        homeVisits: [
          {
            date: new Date("2026-03-20"),
            status: "deficiencies",
            notes: "fix windows",
            createdByName: "Cmdr",
          },
        ],
      }),
    ] as never);

    const result = await fetchHomeVisitReport("c1", ["p1", "p2"]);
    expect(result!.platoons).toHaveLength(2);
    expect(result!.platoons[0].visitedCount).toBe(1);
    expect(result!.platoons[0].totalCount).toBe(2);
    expect(result!.platoons[1].visitedCount).toBe(1);
    expect(result!.platoons[1].totalCount).toBe(1);
    expect(result!.totalVisited).toBe(2);
    expect(result!.totalSoldiers).toBe(3);
  });

  it("includes soldiers with no visits in the soldier list", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([makeSoldier({ id: "s1" })] as never);

    const result = await fetchHomeVisitReport("c1", ["p1"]);
    expect(result!.platoons[0].squads[0].soldiers).toHaveLength(1);
    expect(result!.platoons[0].squads[0].soldiers[0].visits).toEqual([]);
    expect(result!.platoons[0].visitedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// renderHomeVisitReportHtml
// ---------------------------------------------------------------------------

describe("renderHomeVisitReportHtml", () => {
  const baseData: HomeVisitReportData = {
    cycleName: "Cycle 2026",
    platoons: [
      {
        platoonId: "p1",
        platoonName: "Platoon 1",
        companyName: "Company A",
        squads: [
          {
            id: "sq1",
            name: "Squad 1",
            soldiers: [
              {
                id: "s1",
                name: "Cohen Avi",
                visits: [
                  {
                    date: "2026-04-01",
                    status: "in_order",
                    notes: "All good",
                    createdByName: "Cmdr",
                  },
                ],
              },
              { id: "s2", name: "Levy Dan", visits: [] },
            ],
          },
        ],
        visitedCount: 1,
        totalCount: 2,
      },
    ],
    totalVisited: 1,
    totalSoldiers: 2,
  };

  it("renders soldier names and visit details", () => {
    const html = renderHomeVisitReportHtml(baseData);
    expect(html).toContain("Cohen Avi");
    expect(html).toContain("Levy Dan");
    expect(html).toContain("All good");
    expect(html).toContain("תקין");
    expect(html).toContain("לא בוצע");
  });

  it("renders summary count", () => {
    const html = renderHomeVisitReportHtml(baseData);
    expect(html).toContain("1/2");
    expect(html).toContain("Cycle 2026");
  });

  it("escapes HTML in soldier names and notes", () => {
    const html = renderHomeVisitReportHtml({
      ...baseData,
      platoons: [
        {
          ...baseData.platoons[0],
          squads: [
            {
              id: "sq1",
              name: "Squad 1",
              soldiers: [
                {
                  id: "s1",
                  name: "<script>",
                  visits: [
                    {
                      date: "2026-04-01",
                      status: "in_order",
                      notes: "<b>bold</b>",
                      createdByName: "Cmdr",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("hides platoon header when only one platoon is present", () => {
    const html = renderHomeVisitReportHtml(baseData);
    expect(html).not.toContain("Company A — Platoon 1");
  });

  it("shows platoon header when multiple platoons are present", () => {
    const html = renderHomeVisitReportHtml({
      ...baseData,
      platoons: [
        ...baseData.platoons,
        {
          platoonId: "p2",
          platoonName: "Platoon 2",
          companyName: "Company A",
          squads: [],
          visitedCount: 0,
          totalCount: 0,
        },
      ],
    });
    expect(html).toContain("Platoon 1");
    expect(html).toContain("Platoon 2");
  });
});
