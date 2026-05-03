// Shared constants for soldier incidents (אירועים).
// Used by IncidentSection, IncidentForm, and the reports.

export type IncidentType = "commendation" | "discipline" | "safety";

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  commendation: "צל״ש",
  discipline: "משמעת",
  safety: "בטיחות",
};

export interface SubtypeOption {
  value: string;
  label: string;
}

export const SUBTYPE_OPTIONS: Record<IncidentType, SubtypeOption[]> = {
  commendation: [
    { value: "fitness", label: "כושר" },
    { value: "teamwork", label: "עבודת צוות" },
    { value: "general", label: "כללי" },
  ],
  discipline: [
    { value: "smoking", label: "עישון" },
    { value: "reliability", label: "אמינות" },
    { value: "general", label: "כללי" },
  ],
  safety: [
    { value: "weapon", label: "מטווח" },
    { value: "general", label: "כללי" },
  ],
};

/** Display label for a subtype value within a given type — falls back to the raw value. */
export function getSubtypeLabel(type: string, subtype: string | null | undefined): string | null {
  if (!subtype) return null;
  const options = SUBTYPE_OPTIONS[type as IncidentType];
  if (!options) return subtype;
  const match = options.find((o) => o.value === subtype);
  return match?.label ?? subtype;
}
