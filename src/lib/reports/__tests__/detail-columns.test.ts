import { describe, it, expect, vi } from "vitest";
import {
  extractRequestFields,
  formatNotes,
  renderDetailColumnsHtml,
  type RequestDetailInput,
  type DetailFormatters,
  type DetailColumnsData,
} from "../detail-columns";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const identity: DetailFormatters = {
  text: (s) => s,
  dateTime: (s) => `DT:${s}`,
  date: (s) => `D:${s}`,
  appointment: (a) => `${a.date} ${a.place} ${a.type}`,
  sickDay: (d) => `SD:${d.date}`,
  transportationLabels: { bus: "אוטובוס", train: "רכבת" },
};

function makeReq(overrides: Partial<RequestDetailInput>): RequestDetailInput {
  return {
    type: "leave",
    description: null,
    place: null,
    departureAt: null,
    returnAt: null,
    transportation: null,
    paramedicDate: null,
    medicalAppointments: null,
    sickDays: null,
    specialConditions: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractRequestFields
// ---------------------------------------------------------------------------

describe("extractRequestFields", () => {
  it("returns empty fields and appointments when request has no data", () => {
    const result = extractRequestFields(makeReq({}), identity);
    expect(result.fields).toEqual([]);
    expect(result.appointments).toEqual([]);
  });

  it("includes description when present", () => {
    const result = extractRequestFields(makeReq({ description: "Test desc" }), identity);
    expect(result.fields).toEqual([{ label: "תיאור", value: "Test desc" }]);
  });

  // --- Leave type ---

  it("extracts leave fields (place, departure, return, transportation)", () => {
    const req = makeReq({
      type: "leave",
      place: "Tel Aviv",
      departureAt: "2026-04-10T08:00:00Z",
      returnAt: "2026-04-12T18:00:00Z",
      transportation: "bus",
    });
    const result = extractRequestFields(req, identity);

    expect(result.fields).toEqual([
      { label: "מקום", value: "Tel Aviv" },
      { label: "יציאה", value: "DT:2026-04-10T08:00:00Z", highlight: false },
      { label: "חזרה", value: "DT:2026-04-12T18:00:00Z", highlight: false },
      { label: "הגעה", value: "אוטובוס" },
    ]);
  });

  it("highlights leave dates when highlightDates is true", () => {
    const req = makeReq({
      type: "leave",
      departureAt: "2026-04-10T08:00:00Z",
      returnAt: "2026-04-12T18:00:00Z",
    });
    const result = extractRequestFields(req, identity, { highlightDates: true });

    expect(result.fields[0].highlight).toBe(true);
    expect(result.fields[1].highlight).toBe(true);
  });

  it("falls back to raw transportation value when no label exists", () => {
    const req = makeReq({ type: "leave", transportation: "helicopter" });
    const result = extractRequestFields(req, identity);
    expect(result.fields[0].value).toBe("helicopter");
  });

  // --- Medical type ---

  it("extracts medical fields (paramedicDate, sickDays)", () => {
    const req = makeReq({
      type: "medical",
      paramedicDate: "2026-04-15",
      sickDays: [{ id: "d1", date: "2026-04-16" }, { id: "d2", date: "2026-04-17" }],
    });
    const result = extractRequestFields(req, identity);

    expect(result.fields).toEqual([
      { label: 'בדיקת חופ"ל', value: "D:2026-04-15" },
    ]);
    expect(result.sickDays).toHaveLength(2);
    expect(result.sickDays[0].text).toBe("SD:2026-04-16");
    expect(result.sickDays[1].text).toBe("SD:2026-04-17");
  });

  it("extracts medical appointments", () => {
    const req = makeReq({
      type: "medical",
      medicalAppointments: [
        { id: "1", date: "2026-04-10", place: "Hospital", type: "Xray" },
        { id: "2", date: "2026-04-20", place: "Clinic", type: "Checkup" },
      ],
    });
    const result = extractRequestFields(req, identity);

    expect(result.appointments).toHaveLength(2);
    expect(result.appointments[0].text).toBe("2026-04-10 Hospital Xray");
    expect(result.appointments[1].text).toBe("2026-04-20 Clinic Checkup");
  });

  it("highlights the next upcoming appointment when highlightDates is true", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    const req = makeReq({
      type: "medical",
      medicalAppointments: [
        { id: "1", date: "2026-04-10", place: "A", type: "X" },
        { id: "2", date: "2026-04-20", place: "B", type: "Y" },
        { id: "3", date: "2026-04-25", place: "C", type: "Z" },
      ],
    });
    const result = extractRequestFields(req, identity, { highlightDates: true });

    // Past appointment — not highlighted
    expect(result.appointments[0].highlight).toBeUndefined();
    // First future appointment — highlighted
    expect(result.appointments[1].highlight).toBe(true);
    // Second future appointment — not highlighted (only first gets it)
    expect(result.appointments[2].highlight).toBeUndefined();

    vi.useRealTimers();
  });

  it("skips appointments when medicalAppointments is empty array", () => {
    const req = makeReq({ type: "medical", medicalAppointments: [] });
    const result = extractRequestFields(req, identity);
    expect(result.appointments).toEqual([]);
  });

  it("handles empty sickDays array", () => {
    const req = makeReq({ type: "medical", sickDays: [] });
    const result = extractRequestFields(req, identity);
    expect(result.sickDays).toEqual([]);
  });

  // --- Hardship type ---

  it("extracts hardship specialConditions = true", () => {
    const req = makeReq({ type: "hardship", specialConditions: true });
    const result = extractRequestFields(req, identity);
    expect(result.fields).toEqual([{ label: "אוכלוסיות מיוחדות", value: "כן" }]);
  });

  it("extracts hardship specialConditions = false", () => {
    const req = makeReq({ type: "hardship", specialConditions: false });
    const result = extractRequestFields(req, identity);
    expect(result.fields).toEqual([{ label: "אוכלוסיות מיוחדות", value: "לא" }]);
  });

  it("skips hardship specialConditions when null", () => {
    const req = makeReq({ type: "hardship", specialConditions: null });
    const result = extractRequestFields(req, identity);
    expect(result.fields).toEqual([]);
  });

  // --- Unknown type ---

  it("returns only description for unknown request type", () => {
    const req = makeReq({ type: "unknown", description: "Something" });
    const result = extractRequestFields(req, identity);
    expect(result.fields).toEqual([{ label: "תיאור", value: "Something" }]);
    expect(result.appointments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatNotes
// ---------------------------------------------------------------------------

describe("formatNotes", () => {
  it("formats notes with known action labels", () => {
    const notes = [
      { action: "create", userName: "Cohen Avi", note: "New request" },
      { action: "approve", userName: "Levi Dan", note: "OK" },
    ];
    const result = formatNotes(notes);
    expect(result).toEqual([
      { label: "Cohen Avi (יצירה)", value: "New request" },
      { label: "Levi Dan (אישור)", value: "OK" },
    ]);
  });

  it("passes through unknown action names", () => {
    const notes = [{ action: "custom_action", userName: "User", note: "Note" }];
    const result = formatNotes(notes);
    expect(result[0].label).toBe("User (custom_action)");
  });

  it("applies escapeText to userName and note", () => {
    const escape = (s: string) => s.replace(/</g, "&lt;");
    const notes = [{ action: "note", userName: "<script>", note: "<b>bold</b>" }];
    const result = formatNotes(notes, escape);
    expect(result[0].label).toBe("&lt;script> (הערה)");
    expect(result[0].value).toBe("&lt;b>bold&lt;/b>");
  });

  it("handles all action types", () => {
    const actions = ["create", "approve", "deny", "acknowledge", "note"];
    const labels = ["יצירה", "אישור", "דחיה", "אישור קבלה", "הערה"];
    actions.forEach((action, i) => {
      const result = formatNotes([{ action, userName: "U", note: "N" }]);
      expect(result[0].label).toBe(`U (${labels[i]})`);
    });
  });
});

// ---------------------------------------------------------------------------
// renderDetailColumnsHtml
// ---------------------------------------------------------------------------

describe("renderDetailColumnsHtml", () => {
  it("returns empty string when all arrays are empty", () => {
    const data: DetailColumnsData = { fields: [], appointments: [], sickDays: [], notes: [] };
    expect(renderDetailColumnsHtml(data)).toBe("");
  });

  it("renders fields as a table", () => {
    const data: DetailColumnsData = {
      fields: [{ label: "מקום", value: "Tel Aviv" }],
      appointments: [],
      sickDays: [],
      notes: [],
    };
    const html = renderDetailColumnsHtml(data);
    expect(html).toContain('<div class="detail-columns">');
    expect(html).toContain('<table class="detail-grid">');
    expect(html).toContain('<td class="detail-label">מקום</td>');
    expect(html).toContain("<td>Tel Aviv</td>");
  });

  it("renders highlighted field values with strong tag", () => {
    const data: DetailColumnsData = {
      fields: [{ label: "יציאה", value: "2026-04-10", highlight: true }],
      appointments: [],
      sickDays: [],
      notes: [],
    };
    const html = renderDetailColumnsHtml(data);
    expect(html).toContain('<strong class="detail-highlight">2026-04-10</strong>');
  });

  it("renders appointments as a list", () => {
    const data: DetailColumnsData = {
      fields: [],
      appointments: [
        { text: "10/04 Hospital Xray" },
        { text: "20/04 Clinic Checkup", highlight: true },
      ],
      sickDays: [],
      notes: [],
    };
    const html = renderDetailColumnsHtml(data);
    expect(html).toContain('<div class="detail-appointments">');
    expect(html).toContain("<li>10/04 Hospital Xray</li>");
    expect(html).toContain('<li><strong class="detail-highlight">20/04 Clinic Checkup</strong></li>');
  });

  it("renders notes", () => {
    const data: DetailColumnsData = {
      fields: [],
      appointments: [],
      sickDays: [],
      notes: [{ label: "Cohen (יצירה)", value: "New request" }],
    };
    const html = renderDetailColumnsHtml(data);
    expect(html).toContain('<div class="detail-notes">');
    expect(html).toContain('<span class="detail-label">Cohen (יצירה):</span>');
    expect(html).toContain("New request");
  });

  it("renders all three sections together", () => {
    const data: DetailColumnsData = {
      fields: [{ label: "L", value: "V" }],
      appointments: [{ text: "appt" }],
      sickDays: [],
      notes: [{ label: "N", value: "note" }],
    };
    const html = renderDetailColumnsHtml(data);
    expect(html).toContain("detail-grid");
    expect(html).toContain("detail-appointments");
    expect(html).toContain("detail-notes");
  });
});
