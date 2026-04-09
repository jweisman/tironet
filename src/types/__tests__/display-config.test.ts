import { describe, it, expect } from "vitest";
import {
  getResultLabels,
  getNoteOptions,
  parseDisplayConfig,
  DEFAULT_RESULT_LABELS,
} from "../display-config";

describe("getResultLabels", () => {
  it("returns defaults when config is null", () => {
    expect(getResultLabels(null)).toEqual(DEFAULT_RESULT_LABELS);
  });

  it("returns defaults when config is undefined", () => {
    expect(getResultLabels(undefined)).toEqual(DEFAULT_RESULT_LABELS);
  });

  it("returns defaults when results is missing", () => {
    expect(getResultLabels({})).toEqual(DEFAULT_RESULT_LABELS);
  });

  it("returns custom labels", () => {
    const config = {
      results: {
        passed: { label: "נוכח" },
        failed: { label: "לא נוכח" },
        na: { label: "פטור" },
      },
    };
    expect(getResultLabels(config)).toEqual(config.results);
  });

  it("fills in defaults for missing keys", () => {
    const config = {
      results: {
        passed: { label: "ביצע" },
      },
    };
    const labels = getResultLabels(config);
    expect(labels.passed.label).toBe("ביצע");
    expect(labels.failed.label).toBe("נכשל");
    expect(labels.na.label).toBe("לא רלוונטי");
  });
});

describe("getNoteOptions", () => {
  it("returns null when config is null", () => {
    expect(getNoteOptions(null)).toBeNull();
  });

  it("returns null when note config is missing", () => {
    expect(getNoteOptions({})).toBeNull();
  });

  it("returns options when note type is list", () => {
    const config = {
      note: { type: "list" as const, options: ["קיר", "חבל", "זמן"] },
    };
    expect(getNoteOptions(config)).toEqual(["קיר", "חבל", "זמן"]);
  });
});

describe("parseDisplayConfig", () => {
  it("returns null for null input", () => {
    expect(parseDisplayConfig(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseDisplayConfig(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseDisplayConfig("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseDisplayConfig("{invalid")).toBeNull();
  });

  it("parses valid JSON", () => {
    const json = JSON.stringify({
      results: {
        passed: { label: "נוכח" },
        failed: { label: "לא נוכח" },
        na: { label: "פטור" },
      },
      note: { type: "list", options: ["א", "ב"] },
    });
    const config = parseDisplayConfig(json);
    expect(config).not.toBeNull();
    expect(config!.results!.passed!.label).toBe("נוכח");
    expect(config!.note!.options).toEqual(["א", "ב"]);
  });
});
