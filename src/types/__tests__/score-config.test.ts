import { describe, it, expect } from "vitest";
import {
  getActiveScores,
  parseScoreConfig,
  type ScoreConfig,
} from "../score-config";

// ---------------------------------------------------------------------------
// getActiveScores
// ---------------------------------------------------------------------------

describe("getActiveScores", () => {
  it("returns empty array for null config", () => {
    expect(getActiveScores(null)).toEqual([]);
  });

  it("returns empty array for undefined config", () => {
    expect(getActiveScores(undefined)).toEqual([]);
  });

  it("returns empty array when all slots are null", () => {
    const config: ScoreConfig = {
      score1: null, score2: null, score3: null,
      score4: null, score5: null, score6: null,
    };
    expect(getActiveScores(config)).toEqual([]);
  });

  it("returns active scores with correct key, gradeKey, label, and format", () => {
    const config: ScoreConfig = {
      score1: { label: "Speed", format: "time" },
      score2: null,
      score3: { label: "Accuracy", format: "number" },
      score4: null,
      score5: null,
      score6: null,
    };
    const result = getActiveScores(config);
    expect(result).toEqual([
      { key: "score1", gradeKey: "grade1", label: "Speed", format: "time" },
      { key: "score3", gradeKey: "grade3", label: "Accuracy", format: "number" },
    ]);
  });

  it("preserves order of SCORE_KEYS", () => {
    const config: ScoreConfig = {
      score1: null,
      score2: null,
      score3: null,
      score4: null,
      score5: { label: "Fifth", format: "number" },
      score6: { label: "Sixth", format: "time" },
    };
    const result = getActiveScores(config);
    expect(result[0].key).toBe("score5");
    expect(result[1].key).toBe("score6");
  });

  it("defaults format to 'number' when format is missing", () => {
    const config: ScoreConfig = {
      score1: { label: "NoFormat" } as ScoreConfig["score1"],
      score2: null, score3: null, score4: null, score5: null, score6: null,
    };
    const result = getActiveScores(config);
    expect(result[0].format).toBe("number");
  });

  it("handles all six slots active", () => {
    const config: ScoreConfig = {
      score1: { label: "A", format: "number" },
      score2: { label: "B", format: "time" },
      score3: { label: "C", format: "number" },
      score4: { label: "D", format: "time" },
      score5: { label: "E", format: "number" },
      score6: { label: "F", format: "time" },
    };
    const result = getActiveScores(config);
    expect(result).toHaveLength(6);
    expect(result.map((s) => s.gradeKey)).toEqual([
      "grade1", "grade2", "grade3", "grade4", "grade5", "grade6",
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseScoreConfig
// ---------------------------------------------------------------------------

describe("parseScoreConfig", () => {
  it("returns null for null input", () => {
    expect(parseScoreConfig(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseScoreConfig(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseScoreConfig("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseScoreConfig("{not json")).toBeNull();
  });

  it("parses valid JSON into ScoreConfig", () => {
    const config: ScoreConfig = {
      score1: { label: "Speed", format: "time" },
      score2: null, score3: null, score4: null, score5: null, score6: null,
    };
    const result = parseScoreConfig(JSON.stringify(config));
    expect(result).toEqual(config);
  });
});
