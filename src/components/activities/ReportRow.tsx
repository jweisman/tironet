"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { ActivityResult } from "@/types";

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
    grade: number | null;
    note: string | null;
  };
  disabled?: boolean;
  onChange: (
    soldierId: string,
    field: "result" | "grade" | "note",
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

export function ReportRow({ soldier, report, disabled = false, onChange }: ReportRowProps) {
  const gradeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initials = (soldier.givenName[0] ?? "") + (soldier.familyName[0] ?? "");
  const colorClass = getAvatarColor(soldier.givenName + soldier.familyName);

  function handleResultClick(val: ActivityResult) {
    // Clicking active result deselects it
    const newResult = report.result === val ? null : val;
    onChange(soldier.id, "result", newResult);
  }

  function handleGradeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (gradeDebounceRef.current) clearTimeout(gradeDebounceRef.current);
    gradeDebounceRef.current = setTimeout(() => {
      const num = raw === "" ? null : Number(raw);
      onChange(soldier.id, "grade", num);
    }, 500);
  }

  function handleNoteChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      onChange(soldier.id, "note", val || null);
    }, 500);
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
            עבר
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
            נכשל
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
            לא רלוונטי
          </button>
        </div>
      </div>

      {/* Grade + note (only shown when result is set) */}
      {report.result !== null && (
        <div className="flex gap-2 mt-2 ps-[52px]">
          <input
            type="number"
            min={0}
            max={100}
            defaultValue={report.grade ?? ""}
            onChange={handleGradeChange}
            placeholder="ציון (0-100)"
            className="w-28 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            dir="ltr"
          />
          <input
            type="text"
            defaultValue={report.note ?? ""}
            onChange={handleNoteChange}
            placeholder="הערה"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
    </div>
  );
}
