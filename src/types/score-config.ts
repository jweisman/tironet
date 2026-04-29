export interface ScoreSlot {
  label: string;
  format: "number" | "time";
  threshold?: number | null;
  thresholdOperator?: ">" | ">=" | "<" | "<=" | null;
}

export type ScoreConfig = {
  score1: ScoreSlot | null;
  score2: ScoreSlot | null;
  score3: ScoreSlot | null;
  score4: ScoreSlot | null;
  score5: ScoreSlot | null;
  score6: ScoreSlot | null;
  failureThreshold?: number | null;
};

export const SCORE_KEYS = ["score1", "score2", "score3", "score4", "score5", "score6"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export type GradeKey = "grade1" | "grade2" | "grade3" | "grade4" | "grade5" | "grade6";

export interface ActiveScore {
  key: ScoreKey;
  gradeKey: GradeKey;
  label: string;
  format: "number" | "time";
  threshold: number | null;
  thresholdOperator: ">" | ">=" | "<" | "<=" | null;
}

/**
 * Extract ordered active scores from a ScoreConfig.
 * Returns only non-null slots with their key, label, format, and corresponding grade column.
 */
export function getActiveScores(config: ScoreConfig | null | undefined): ActiveScore[] {
  if (!config) return [];
  return SCORE_KEYS
    .map((k) => {
      const slot = config[k];
      if (!slot) return null;
      const index = k.replace("score", "");
      return {
        key: k,
        gradeKey: `grade${index}` as GradeKey,
        label: slot.label,
        format: slot.format ?? "number",
        threshold: slot.threshold ?? null,
        thresholdOperator: slot.thresholdOperator ?? null,
      };
    })
    .filter((s): s is ActiveScore => s !== null);
}

/**
 * Parse a JSON string (from PowerSync SQLite text column) into a ScoreConfig.
 * Returns null if input is null/undefined or invalid JSON.
 */
export function parseScoreConfig(raw: string | null | undefined): ScoreConfig | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScoreConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Score threshold evaluation
// ---------------------------------------------------------------------------

export type ScoreResult = "passed" | "failed" | null;

/**
 * Evaluate a single score against its threshold.
 * The operator defines the **failing** condition:
 * - `">"` → fail if value > threshold (e.g., time scores — lower is better)
 * - `">="` → fail if value >= threshold
 * - `"<"` → fail if value < threshold (e.g., point scores — higher is better)
 * - `"<="` → fail if value <= threshold
 *
 * Returns null if value, threshold, or operator is missing (can't evaluate).
 */
export function evaluateScore(
  value: number | null | undefined,
  threshold: number | null | undefined,
  operator: ">" | ">=" | "<" | "<=" | null | undefined,
): ScoreResult {
  if (value == null || threshold == null || !operator) return null;
  switch (operator) {
    case ">": return value > threshold ? "failed" : "passed";
    case ">=": return value >= threshold ? "failed" : "passed";
    case "<": return value < threshold ? "failed" : "passed";
    case "<=": return value <= threshold ? "failed" : "passed";
  }
}

export interface FailureCalculation {
  failed: boolean;
  scoreResults: Map<GradeKey, ScoreResult>;
}

/**
 * Calculate whether an activity report is failed based on score thresholds.
 *
 * For each active score with a threshold configured, evaluates the grade
 * against the threshold. If the number of individually-failed scores meets
 * or exceeds `failureThreshold`, the report is marked as failed.
 *
 * Returns `failed: false` if failureThreshold is null/undefined (no auto-failure
 * configured for this activity type).
 */
export function calculateFailure(
  grades: Record<string, number | null>,
  activeScores: ActiveScore[],
  failureThreshold: number | null | undefined,
): FailureCalculation {
  const scoreResults = new Map<GradeKey, ScoreResult>();

  // No threshold configured — skip all evaluation
  if (!failureThreshold) {
    return { failed: false, scoreResults };
  }

  for (const score of activeScores) {
    const result = evaluateScore(
      grades[score.gradeKey],
      score.threshold,
      score.thresholdOperator,
    );
    scoreResults.set(score.gradeKey, result);
  }

  let failedCount = 0;
  for (const result of scoreResults.values()) {
    if (result === "failed") failedCount++;
  }

  return { failed: failedCount >= failureThreshold, scoreResults };
}
