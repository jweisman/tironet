export interface ResultLabelConfig {
  label: string;
}

export interface ResultLabels {
  completed: ResultLabelConfig;
  skipped: ResultLabelConfig;
  na: ResultLabelConfig;
}

export interface NoteConfig {
  type: "list";
  options: string[];
}

export interface DisplayConfiguration {
  results?: Partial<ResultLabels>;
  note?: NoteConfig;
}

export const DEFAULT_RESULT_LABELS: ResultLabels = {
  completed: { label: "ביצע" },
  skipped: { label: "לא ביצע" },
  na: { label: "לא רלוונטי" },
};

/**
 * Get fully resolved result labels, falling back to defaults for any missing keys.
 */
export function getResultLabels(config: DisplayConfiguration | null | undefined): ResultLabels {
  if (!config?.results) return DEFAULT_RESULT_LABELS;
  return {
    completed: config.results.completed ?? DEFAULT_RESULT_LABELS.completed,
    skipped: config.results.skipped ?? DEFAULT_RESULT_LABELS.skipped,
    na: config.results.na ?? DEFAULT_RESULT_LABELS.na,
  };
}

/**
 * Get note dropdown options, or null if note is free-text (default).
 */
export function getNoteOptions(config: DisplayConfiguration | null | undefined): string[] | null {
  if (!config?.note || config.note.type !== "list") return null;
  return config.note.options;
}

/**
 * Parse a JSON string (from PowerSync SQLite text column) into a DisplayConfiguration.
 * Returns null if input is null/undefined or invalid JSON.
 */
export function parseDisplayConfig(raw: string | null | undefined): DisplayConfiguration | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DisplayConfiguration;
  } catch {
    return null;
  }
}
