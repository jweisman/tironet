import { describe, it, expect } from "vitest";
import {
  getActiveScores,
  parseScoreConfig,
  evaluateScore,
  calculateFailure,
  type ScoreConfig,
  type ActiveScore,
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
      { key: "score1", gradeKey: "grade1", label: "Speed", format: "time", threshold: null, thresholdOperator: null },
      { key: "score3", gradeKey: "grade3", label: "Accuracy", format: "number", threshold: null, thresholdOperator: null },
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

// ---------------------------------------------------------------------------
// evaluateScore
// ---------------------------------------------------------------------------

describe("evaluateScore", () => {
  it("returns null when value is null", () => {
    expect(evaluateScore(null, 50, "<")).toBeNull();
  });

  it("returns null when threshold is null", () => {
    expect(evaluateScore(75, null, "<")).toBeNull();
  });

  it("returns null when operator is null", () => {
    expect(evaluateScore(75, 50, null)).toBeNull();
  });

  it("returns null when operator is undefined", () => {
    expect(evaluateScore(75, 50, undefined)).toBeNull();
  });

  it('">" operator: fails when value exceeds threshold', () => {
    expect(evaluateScore(60, 50, ">")).toBe("failed");
  });

  it('">" operator: passes when value equals threshold', () => {
    expect(evaluateScore(50, 50, ">")).toBe("passed");
  });

  it('">" operator: passes when value is below threshold', () => {
    expect(evaluateScore(40, 50, ">")).toBe("passed");
  });

  it('">=" operator: fails when value equals threshold', () => {
    expect(evaluateScore(50, 50, ">=")).toBe("failed");
  });

  it('">=" operator: passes when value is below threshold', () => {
    expect(evaluateScore(49, 50, ">=")).toBe("passed");
  });

  it('"<" operator: fails when value is below threshold', () => {
    expect(evaluateScore(40, 50, "<")).toBe("failed");
  });

  it('"<" operator: passes when value equals threshold', () => {
    expect(evaluateScore(50, 50, "<")).toBe("passed");
  });

  it('"<" operator: passes when value exceeds threshold', () => {
    expect(evaluateScore(60, 50, "<")).toBe("passed");
  });

  it('"<=" operator: fails when value equals threshold', () => {
    expect(evaluateScore(50, 50, "<=")).toBe("failed");
  });

  it('"<=" operator: passes when value exceeds threshold', () => {
    expect(evaluateScore(51, 50, "<=")).toBe("passed");
  });
});

// ---------------------------------------------------------------------------
// calculateFailure
// ---------------------------------------------------------------------------

describe("calculateFailure", () => {
  const makeScore = (
    gradeKey: string,
    threshold: number | null,
    operator: ">" | ">=" | "<" | "<=" | null,
  ): ActiveScore => ({
    key: `score${gradeKey.replace("grade", "")}` as ActiveScore["key"],
    gradeKey: gradeKey as ActiveScore["gradeKey"],
    label: `Score ${gradeKey}`,
    format: "number",
    threshold,
    thresholdOperator: operator,
  });

  it("defaults failureThreshold to 1 when null and a score has a threshold", () => {
    const scores = [makeScore("grade1", 50, "<")];
    const result = calculateFailure({ grade1: 30 }, scores, null);
    expect(result.failed).toBe(true);
    expect(result.scoreResults.get("grade1")).toBe("failed");
  });

  it("defaults failureThreshold to 1 when undefined and a score has a threshold", () => {
    const scores = [makeScore("grade1", 50, "<")];
    const result = calculateFailure({ grade1: 30 }, scores, undefined);
    expect(result.failed).toBe(true);
  });

  it("returns failed=false when no score has a threshold configured", () => {
    const scores = [makeScore("grade1", null, null)];
    const result = calculateFailure({ grade1: 30 }, scores, null);
    expect(result.failed).toBe(false);
    expect(result.scoreResults.size).toBe(0);
  });

  it("returns failed=true with single failure and failureThreshold=1", () => {
    const scores = [makeScore("grade1", 50, "<")];
    const result = calculateFailure({ grade1: 30 }, scores, 1);
    expect(result.failed).toBe(true);
    expect(result.scoreResults.get("grade1")).toBe("failed");
  });

  it("returns failed=false when score passes and failureThreshold=1", () => {
    const scores = [makeScore("grade1", 50, "<")];
    const result = calculateFailure({ grade1: 80 }, scores, 1);
    expect(result.failed).toBe(false);
    expect(result.scoreResults.get("grade1")).toBe("passed");
  });

  it("returns failed=true when failures meet failureThreshold=2", () => {
    const scores = [
      makeScore("grade1", 50, "<"),
      makeScore("grade2", 100, ">"),
    ];
    const result = calculateFailure({ grade1: 30, grade2: 150 }, scores, 2);
    expect(result.failed).toBe(true);
    expect(result.scoreResults.get("grade1")).toBe("failed");
    expect(result.scoreResults.get("grade2")).toBe("failed");
  });

  it("returns failed=false when only one failure with failureThreshold=2", () => {
    const scores = [
      makeScore("grade1", 50, "<"),
      makeScore("grade2", 100, ">"),
    ];
    const result = calculateFailure({ grade1: 30, grade2: 80 }, scores, 2);
    expect(result.failed).toBe(false);
    expect(result.scoreResults.get("grade1")).toBe("failed");
    expect(result.scoreResults.get("grade2")).toBe("passed");
  });

  it("null grade is not counted as failure", () => {
    const scores = [makeScore("grade1", 50, "<")];
    const result = calculateFailure({ grade1: null }, scores, 1);
    expect(result.failed).toBe(false);
    expect(result.scoreResults.get("grade1")).toBeNull();
  });

  it("handles empty active scores", () => {
    const result = calculateFailure({ grade1: 50 }, [], 1);
    expect(result.failed).toBe(false);
    expect(result.scoreResults.size).toBe(0);
  });
});
