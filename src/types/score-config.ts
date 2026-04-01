export interface ScoreSlot {
  label: string;
  format: "number" | "time";
}

export type ScoreConfig = {
  score1: ScoreSlot | null;
  score2: ScoreSlot | null;
  score3: ScoreSlot | null;
  score4: ScoreSlot | null;
  score5: ScoreSlot | null;
  score6: ScoreSlot | null;
};

export const SCORE_KEYS = ["score1", "score2", "score3", "score4", "score5", "score6"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export interface ActiveScore {
  key: ScoreKey;
  gradeKey: "grade1" | "grade2" | "grade3" | "grade4" | "grade5" | "grade6";
  label: string;
  format: "number" | "time";
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
        gradeKey: `grade${index}` as ActiveScore["gradeKey"],
        label: slot.label,
        format: slot.format ?? "number",
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
