import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    cycle: { findUnique: vi.fn() },
    soldier: { findMany: vi.fn() },
  },
}));

import {
  fetchIncidentReport,
  renderIncidentReportHtml,
  renderBarChartSvg,
  type IncidentReportData,
} from "../render-incident-report";
import { prisma } from "@/lib/db/prisma";

const mockCycle = vi.mocked(prisma.cycle.findUnique);
const mockSoldier = vi.mocked(prisma.soldier.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

interface IncidentSeed {
  id?: string;
  type: "commendation" | "discipline" | "safety";
  subtype?: string;
  date: Date;
  description?: string;
  response?: string | null;
  createdByName?: string;
}

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
  incidents: IncidentSeed[];
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
    incidents: (overrides.incidents ?? []).map((inc, idx) => ({
      id: inc.id ?? `inc-${idx}`,
      type: inc.type,
      subtype: inc.subtype ?? "general",
      date: inc.date,
      description: inc.description ?? "desc",
      response: inc.response ?? null,
      createdByName: inc.createdByName ?? "Cmdr",
    })),
  };
}

// ---------------------------------------------------------------------------
// fetchIncidentReport
// ---------------------------------------------------------------------------

describe("fetchIncidentReport", () => {
  it("returns null when cycle does not exist", async () => {
    mockCycle.mockResolvedValueOnce(null);
    const result = await fetchIncidentReport("c1", ["p1"], "squad");
    expect(result).toBeNull();
  });

  it("groups by squad and counts incidents per type", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({
        id: "s1",
        squadId: "sq1",
        incidents: [
          { type: "commendation", date: new Date("2026-04-10") },
          { type: "discipline", date: new Date("2026-04-05") },
        ],
      }),
      makeSoldier({
        id: "s2",
        familyName: "Levy",
        givenName: "Dan",
        squadId: "sq1",
        incidents: [{ type: "safety", date: new Date("2026-04-01") }],
      }),
      makeSoldier({
        id: "s3",
        familyName: "Mizrahi",
        givenName: "Eli",
        squadId: "sq2",
        squadName: "Squad 2",
        squadSortOrder: 2,
        incidents: [
          { type: "discipline", date: new Date("2026-03-30") },
          { type: "discipline", date: new Date("2026-04-12") },
        ],
      }),
    ] as never);

    const result = await fetchIncidentReport("c1", ["p1"], "squad");
    expect(result).not.toBeNull();
    expect(result!.cycleName).toBe("Cycle 2026");
    expect(result!.groupBy).toBe("squad");
    expect(result!.groups).toHaveLength(2);

    const sq1 = result!.groups.find((g) => g.id === "sq1")!;
    expect(sq1.name).toBe("Squad 1");
    expect(sq1.counts).toEqual({ commendation: 1, discipline: 1, safety: 1 });
    expect(sq1.incidents).toHaveLength(3);

    const sq2 = result!.groups.find((g) => g.id === "sq2")!;
    expect(sq2.counts).toEqual({ commendation: 0, discipline: 2, safety: 0 });
    expect(sq2.incidents).toHaveLength(2);

    expect(result!.totals).toEqual({ commendation: 1, discipline: 3, safety: 1 });
  });

  it("groups by platoon when groupBy is platoon", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({
        id: "s1",
        platoonId: "p1",
        platoonName: "Platoon 1",
        incidents: [{ type: "commendation", date: new Date("2026-04-10") }],
      }),
      makeSoldier({
        id: "s2",
        platoonId: "p1",
        platoonName: "Platoon 1",
        squadId: "sq2",
        squadName: "Squad 2",
        incidents: [{ type: "safety", date: new Date("2026-04-05") }],
      }),
      makeSoldier({
        id: "s3",
        platoonId: "p2",
        platoonName: "Platoon 2",
        platoonSortOrder: 2,
        squadId: "sq3",
        squadName: "Squad 3",
        incidents: [{ type: "discipline", date: new Date("2026-04-08") }],
      }),
    ] as never);

    const result = await fetchIncidentReport("c1", ["p1", "p2"], "platoon");
    expect(result!.groupBy).toBe("platoon");
    expect(result!.groups).toHaveLength(2);
    const p1 = result!.groups.find((g) => g.id === "p1")!;
    expect(p1.name).toBe("Company A — Platoon 1");
    expect(p1.counts).toEqual({ commendation: 1, discipline: 0, safety: 1 });
    expect(p1.incidents).toHaveLength(2);
    const p2 = result!.groups.find((g) => g.id === "p2")!;
    expect(p2.counts).toEqual({ commendation: 0, discipline: 1, safety: 0 });
  });

  it("sorts incidents within a group by date descending", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({
        id: "s1",
        incidents: [
          { type: "commendation", date: new Date("2026-04-10") },
          { type: "discipline", date: new Date("2026-04-05") },
        ],
      }),
      makeSoldier({
        id: "s2",
        familyName: "Levy",
        givenName: "Dan",
        incidents: [{ type: "safety", date: new Date("2026-04-15") }],
      }),
    ] as never);

    const result = await fetchIncidentReport("c1", ["p1"], "squad");
    const dates = result!.groups[0].incidents.map((i) => i.date);
    expect(dates).toEqual(["2026-04-15", "2026-04-10", "2026-04-05"]);
  });

  it("excludes groups with no soldiers and includes groups with no incidents", async () => {
    mockCycle.mockResolvedValueOnce({ name: "Cycle 2026" } as never);
    mockSoldier.mockResolvedValueOnce([
      makeSoldier({ id: "s1", squadId: "sq1", incidents: [] }),
    ] as never);

    const result = await fetchIncidentReport("c1", ["p1"], "squad");
    expect(result!.groups).toHaveLength(1);
    expect(result!.groups[0].incidents).toHaveLength(0);
    expect(result!.groups[0].counts).toEqual({ commendation: 0, discipline: 0, safety: 0 });
    expect(result!.totals).toEqual({ commendation: 0, discipline: 0, safety: 0 });
  });
});

// ---------------------------------------------------------------------------
// renderBarChartSvg
// ---------------------------------------------------------------------------

describe("renderBarChartSvg", () => {
  it("returns no-data placeholder when there are no groups", () => {
    const out = renderBarChartSvg({
      cycleName: "C",
      groupBy: "squad",
      groups: [],
      totals: { commendation: 0, discipline: 0, safety: 0 },
    });
    expect(out).toContain("אין נתונים");
  });

  it("renders one rect per type per group and labels", () => {
    const out = renderBarChartSvg({
      cycleName: "C",
      groupBy: "squad",
      groups: [
        {
          id: "sq1",
          name: "Squad 1",
          counts: { commendation: 2, discipline: 1, safety: 0 },
          incidents: [],
        },
        {
          id: "sq2",
          name: "Squad 2",
          counts: { commendation: 0, discipline: 3, safety: 1 },
          incidents: [],
        },
      ],
      totals: { commendation: 2, discipline: 4, safety: 1 },
    });
    expect(out).toContain("<svg");
    // 2 groups * 3 types = 6 rects
    expect(out.match(/<rect /g)?.length).toBe(6);
    expect(out).toContain("Squad 1");
    expect(out).toContain("Squad 2");
  });
});

// ---------------------------------------------------------------------------
// renderIncidentReportHtml
// ---------------------------------------------------------------------------

describe("renderIncidentReportHtml", () => {
  const baseData: IncidentReportData = {
    cycleName: "Cycle 2026",
    groupBy: "squad",
    groups: [
      {
        id: "sq1",
        name: "Squad 1",
        counts: { commendation: 1, discipline: 1, safety: 0 },
        incidents: [
          {
            id: "i1",
            soldierId: "s1",
            soldierName: "Cohen Avi",
            squadName: "Squad 1",
            type: "commendation",
            subtype: "fitness",
            date: "2026-04-10",
            description: "Top score on run",
            response: null,
            createdByName: "Cmdr",
          },
          {
            id: "i2",
            soldierId: "s2",
            soldierName: "Levy Dan",
            squadName: "Squad 1",
            type: "discipline",
            subtype: "smoking",
            date: "2026-04-05",
            description: "Smoking on base",
            response: "Counseled",
            createdByName: "Cmdr",
          },
        ],
      },
    ],
    totals: { commendation: 1, discipline: 1, safety: 0 },
  };

  it("renders title, totals, and group contents", () => {
    const html = renderIncidentReportHtml(baseData);
    expect(html).toContain("Cycle 2026");
    expect(html).toContain("סה״כ אירועים: 2");
    expect(html).toContain("Squad 1");
    expect(html).toContain("Cohen Avi");
    expect(html).toContain("Top score on run");
    expect(html).toContain("Smoking on base");
    expect(html).toContain("Counseled");
    // type labels
    expect(html).toContain("צל״ש");
    expect(html).toContain("משמעת");
    // subtype label
    expect(html).toContain("כושר");
    expect(html).toContain("עישון");
  });

  it("includes legend with totals per type", () => {
    const html = renderIncidentReportHtml(baseData);
    expect(html).toContain("צל״ש (1)");
    expect(html).toContain("משמעת (1)");
    expect(html).toContain("בטיחות (0)");
  });

  it("escapes HTML in soldier names and descriptions", () => {
    const html = renderIncidentReportHtml({
      ...baseData,
      groups: [
        {
          ...baseData.groups[0],
          incidents: [
            {
              ...baseData.groups[0].incidents[0],
              soldierName: "<script>",
              description: "<b>bold</b>",
              response: "<i>italic</i>",
            },
          ],
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;italic&lt;/i&gt;");
  });

  it("shows squad meta when grouping by platoon", () => {
    const platoonData: IncidentReportData = {
      ...baseData,
      groupBy: "platoon",
      groups: [
        {
          id: "p1",
          name: "Company A — Platoon 1",
          counts: { commendation: 1, discipline: 0, safety: 0 },
          incidents: [
            {
              id: "i1",
              soldierId: "s1",
              soldierName: "Cohen Avi",
              squadName: "Squad 7",
              type: "commendation",
              subtype: "general",
              date: "2026-04-10",
              description: "desc",
              response: null,
              createdByName: "Cmdr",
            },
          ],
        },
      ],
    };
    const html = renderIncidentReportHtml(platoonData);
    expect(html).toContain("Company A — Platoon 1");
    expect(html).toContain("Squad 7");
  });

  it("renders 'no incidents' placeholder for empty groups", () => {
    const html = renderIncidentReportHtml({
      ...baseData,
      groups: [
        {
          id: "sq1",
          name: "Squad 1",
          counts: { commendation: 0, discipline: 0, safety: 0 },
          incidents: [],
        },
      ],
      totals: { commendation: 0, discipline: 0, safety: 0 },
    });
    expect(html).toContain("אין אירועים");
  });
});
