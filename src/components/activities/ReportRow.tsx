"use client";

import { memo, useRef } from "react";
import { cn } from "@/lib/utils";
import { parseGradeInput, parseCompactTimeInput, formatGradeDisplay } from "@/lib/score-format";
import type { ActivityResult } from "@/types";
import type { GradeKey } from "./ActivityDetail";
import type { ActiveScore } from "@/types/score-config";
import { evaluateScore } from "@/types/score-config";
import type { ResultLabels } from "@/types/display-config";

interface ReportRowProps {
  soldier: {
    id: string;
    givenName: string;
    familyName: string;
    rank: string | null;
    profileImage: string | null;
  };
  report: {
    id: string | null;
    result: ActivityResult | null;
    failed: boolean;
    grade1: number | null;
    grade2: number | null;
    grade3: number | null;
    grade4: number | null;
    grade5: number | null;
    grade6: number | null;
    note: string | null;
  };
  activeScores: ActiveScore[];
  resultLabels: ResultLabels;
  noteOptions?: string[] | null;
  disabled?: boolean;
  onChange: (
    soldierId: string,
    field: "result" | GradeKey | "note",
    value: unknown
  ) => void;
}

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash];
}

/** Return inline border style for a grade input based on threshold evaluation. */
function getThresholdStyle(
  value: number | null,
  score: ActiveScore,
): React.CSSProperties | undefined {
  const result = evaluateScore(value, score.threshold, score.thresholdOperator);
  if (!result) return undefined;
  if (result === "passed") return { borderColor: "var(--color-green-500)", boxShadow: "0 0 0 1px var(--color-green-500)" };
  return { borderColor: "var(--color-amber-500)", boxShadow: "0 0 0 1px var(--color-amber-500)" };
}

export const ReportRow = memo(function ReportRow({ soldier, report, activeScores, resultLabels, noteOptions, disabled = false, onChange }: ReportRowProps) {
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const initials = (soldier.givenName[0] ?? "") + (soldier.familyName[0] ?? "");
  const colorClass = getAvatarColor(soldier.givenName + soldier.familyName);

  function handleResultClick(val: ActivityResult) {
    const newResult = report.result === val ? null : val;
    onChange(soldier.id, "result", newResult);
  }

  function parseForFormat(raw: string, format: "number" | "time"): number | null {
    return format === "time" ? parseCompactTimeInput(raw) : parseGradeInput(raw, format);
  }

  function handleGradeChange(gradeKey: GradeKey, format: "number" | "time", score: ActiveScore, e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;

    // Live-format time inputs: strip non-digits and insert colon once there are
    // 3+ digits. Users type append-only so forcing the caret to end is fine; on
    // blur, handleGradeBlur normalizes <3-digit values to M:SS (e.g. 43 → 0:43).
    if (format === "time") {
      const digits = el.value.replace(/\D/g, "");
      const formatted = digits.length >= 3
        ? `${digits.slice(0, -2)}:${digits.slice(-2)}`
        : digits;
      if (formatted !== el.value) {
        el.value = formatted;
        el.setSelectionRange(formatted.length, formatted.length);
      }
    }

    const raw = el.value;
    const trimmed = raw.trim();
    const parsed = trimmed !== "" ? parseForFormat(raw, format) : undefined;
    const isInvalid = trimmed !== "" && parsed === null;

    if (isInvalid) {
      el.style.borderColor = "var(--color-destructive)";
      el.style.boxShadow = "0 0 0 1px var(--color-destructive)";
    } else {
      // Apply threshold coloring for valid values
      const thresholdResult = evaluateScore(parsed ?? null, score.threshold, score.thresholdOperator);
      if (thresholdResult === "passed") {
        el.style.borderColor = "var(--color-green-500)";
        el.style.boxShadow = "0 0 0 1px var(--color-green-500)";
      } else if (thresholdResult === "failed") {
        el.style.borderColor = "var(--color-amber-500)";
        el.style.boxShadow = "0 0 0 1px var(--color-amber-500)";
      } else {
        el.style.borderColor = "";
        el.style.boxShadow = "";
      }
    }

    const existing = debounceRefs.current.get(gradeKey);
    if (existing) clearTimeout(existing);
    if (isInvalid) return; // don't save invalid input
    debounceRefs.current.set(gradeKey, setTimeout(() => {
      const num = parseForFormat(raw, format);
      onChange(soldier.id, gradeKey, num);
    }, 500));
  }

  function handleGradeBlur(format: "number" | "time", e: React.FocusEvent<HTMLInputElement>) {
    if (format !== "time") return;
    const el = e.target;
    const parsed = parseCompactTimeInput(el.value);
    if (parsed !== null) el.value = formatGradeDisplay(parsed, "time");
  }

  function handleNoteChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    const existing = debounceRefs.current.get("note");
    if (existing) clearTimeout(existing);
    debounceRefs.current.set("note", setTimeout(() => {
      onChange(soldier.id, "note", val || null);
    }, 500));
  }

  function handleNoteSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    onChange(soldier.id, "note", e.target.value || null);
  }

  return (
    <div className={cn("px-4 py-3", disabled && "opacity-50 pointer-events-none")}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm ${colorClass}`}
        >
          {soldier.profileImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={soldier.profileImage}
              alt={`${soldier.givenName} ${soldier.familyName}`}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <span>{initials}</span>
          )}
        </div>

        {/* Name + rank + failed indicator */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">
            {soldier.familyName} {soldier.givenName}
            {report.failed && (
              <span className="ms-1 inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                נכשל
              </span>
            )}
          </span>
          {soldier.rank && (
            <span className="text-xs text-muted-foreground">{soldier.rank}</span>
          )}
        </div>

        {/* Result toggle buttons */}
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleResultClick("completed")}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
              report.result === "completed"
                ? "bg-green-600 text-white border-green-600"
                : "bg-transparent text-muted-foreground border-border hover:bg-green-50 hover:text-green-700 hover:border-green-200"
            )}
          >
            {resultLabels.completed.label}
          </button>
          <button
            type="button"
            onClick={() => handleResultClick("skipped")}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
              report.result === "skipped"
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-transparent text-muted-foreground border-border hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200"
            )}
          >
            {resultLabels.skipped.label}
          </button>
          <button
            type="button"
            onClick={() => handleResultClick("na")}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
              report.result === "na"
                ? "bg-gray-500 text-white border-gray-500"
                : "bg-transparent text-muted-foreground border-border hover:bg-gray-100"
            )}
          >
            {resultLabels.na.label}
          </button>
        </div>
      </div>

      {/* Grades + note (only shown when result is set) */}
      {report.result !== null && (
        <div className="flex flex-wrap gap-2 mt-2 ps-[52px]">
          {activeScores.map((score) => (
            <input
              key={score.gradeKey}
              type="text"
              inputMode="numeric"
              defaultValue={formatGradeDisplay(report[score.gradeKey], score.format)}
              onChange={(e) => handleGradeChange(score.gradeKey, score.format, score, e)}
              onBlur={(e) => handleGradeBlur(score.format, e)}
              placeholder={score.label}
              aria-label={score.label}
              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              style={getThresholdStyle(report[score.gradeKey], score)}
              dir="ltr"
            />
          ))}
          {(() => {
            const needsNote = (report.result === "skipped" || report.failed) && !report.note;
            const noteHighlight = needsNote ? "border-red-400 ring-1 ring-red-300 placeholder:text-red-400" : "";
            return noteOptions && noteOptions.length > 0 ? (
              <select
                value={noteOptions.includes(report.note ?? "") ? report.note ?? "" : ""}
                onChange={handleNoteSelect}
                aria-label="הערה"
                className={cn("flex-1 min-w-[100px] rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring", noteHighlight)}
              >
                <option value="">{needsNote ? "חובה לבחור..." : "בחר..."}</option>
                {noteOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                defaultValue={report.note ?? ""}
                onChange={handleNoteChange}
                placeholder={needsNote ? "נא להוסיף הערה" : "הערה"}
                aria-label="הערה"
                className={cn("flex-1 min-w-[100px] rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring", noteHighlight)}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
});
