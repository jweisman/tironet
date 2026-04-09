"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { parseGradeInput, formatGradeDisplay } from "@/lib/score-format";
import type { ActivityResult } from "@/types";
import type { GradeKey } from "./ActivityDetail";
import type { ActiveScore } from "@/types/score-config";
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

export function ReportRow({ soldier, report, activeScores, resultLabels, noteOptions, disabled = false, onChange }: ReportRowProps) {
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const initials = (soldier.givenName[0] ?? "") + (soldier.familyName[0] ?? "");
  const colorClass = getAvatarColor(soldier.givenName + soldier.familyName);

  function handleResultClick(val: ActivityResult) {
    const newResult = report.result === val ? null : val;
    onChange(soldier.id, "result", newResult);
  }

  function handleGradeChange(gradeKey: GradeKey, format: "number" | "time", e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const el = e.target;
    const trimmed = raw.trim();
    const isInvalid = trimmed !== "" && parseGradeInput(raw, format) === null;
    el.style.borderColor = isInvalid ? "var(--color-destructive)" : "";
    el.style.boxShadow = isInvalid ? "0 0 0 1px var(--color-destructive)" : "";

    const existing = debounceRefs.current.get(gradeKey);
    if (existing) clearTimeout(existing);
    if (isInvalid) return; // don't save invalid input
    debounceRefs.current.set(gradeKey, setTimeout(() => {
      const num = parseGradeInput(raw, format);
      onChange(soldier.id, gradeKey, num);
    }, 500));
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

        {/* Name + rank */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">
            {soldier.familyName} {soldier.givenName}
          </span>
          {soldier.rank && (
            <span className="text-xs text-muted-foreground">{soldier.rank}</span>
          )}
        </div>

        {/* Result toggle buttons */}
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleResultClick("passed")}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
              report.result === "passed"
                ? "bg-green-600 text-white border-green-600"
                : "bg-transparent text-muted-foreground border-border hover:bg-green-50 hover:text-green-700 hover:border-green-200"
            )}
          >
            {resultLabels.passed.label}
          </button>
          <button
            type="button"
            onClick={() => handleResultClick("failed")}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
              report.result === "failed"
                ? "bg-red-600 text-white border-red-600"
                : "bg-transparent text-muted-foreground border-border hover:bg-red-50 hover:text-red-700 hover:border-red-200"
            )}
          >
            {resultLabels.failed.label}
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
              inputMode={score.format === "time" ? "text" : "numeric"}
              defaultValue={formatGradeDisplay(report[score.gradeKey], score.format)}
              onChange={(e) => handleGradeChange(score.gradeKey, score.format, e)}
              placeholder={score.label}
              aria-label={score.label}
              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              dir="ltr"
            />
          ))}
          {noteOptions && noteOptions.length > 0 ? (
            <select
              value={noteOptions.includes(report.note ?? "") ? report.note ?? "" : ""}
              onChange={handleNoteSelect}
              aria-label="הערה"
              className="flex-1 min-w-[100px] rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">בחר...</option>
              {noteOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              defaultValue={report.note ?? ""}
              onChange={handleNoteChange}
              placeholder="הערה"
              aria-label="הערה"
              className="flex-1 min-w-[100px] rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>
      )}
    </div>
  );
}
