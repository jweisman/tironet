"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";
import type { SoldierReport, GradeKey } from "./ActivityDetail";
import type { ActivityResult } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SoldierInfo {
  id: string;
  idNumber: string | null;
  givenName: string;
  familyName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string;
  activityTypeId: string;
  scoreLabels: string[];
  soldiers: SoldierInfo[];
  existingReports: Map<string, SoldierReport>;
  onImport: (reports: Map<string, SoldierReport>) => Promise<void>;
}

interface ColumnMapping {
  idNumber: number;
  result: number;
  note: number;
  grades: (number | -1)[]; // index per score label, -1 = unmapped
}

interface ParsedReportRow {
  rowIndex: number;
  idNumberRaw: string;
  soldierId: string | null;
  soldierName: string | null;
  result: ActivityResult | null;
  grades: (number | null)[];
  note: string | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNMAPPED = -1;

const RESULT_MAP: Record<string, ActivityResult> = {
  // Hebrew
  "עבר": "passed",
  "עברה": "passed",
  "נכשל": "failed",
  "נכשלה": "failed",
  "לא רלוונטי": "na",
  'לא רלו': "na",
  // English
  "passed": "passed",
  "pass": "passed",
  "failed": "failed",
  "fail": "failed",
  "na": "na",
  "n/a": "na",
  // Numeric
  "1": "passed",
  "0": "failed",
};

// Known Hebrew field names for auto-detection
const ID_HINTS = ["מספר אישי", "מ.א.", "מ.א", "מא", "id", "id_number", "personal"];
const RESULT_HINTS = ["תוצאה", "result", "ציון", "עבר/נכשל"];
const NOTE_HINTS = ["הערה", "הערות", "note", "notes"];

function storageKey(activityTypeId: string) {
  return `tironet:report-mapping:${activityTypeId}`;
}

function saveMapping(activityTypeId: string, mapping: ColumnMapping) {
  try {
    localStorage.setItem(storageKey(activityTypeId), JSON.stringify(mapping));
  } catch { /* ignore quota errors */ }
}

function loadMapping(activityTypeId: string): ColumnMapping | null {
  try {
    const raw = localStorage.getItem(storageKey(activityTypeId));
    if (!raw) return null;
    return JSON.parse(raw) as ColumnMapping;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-detect column mapping from headers
// ---------------------------------------------------------------------------

function autoDetectMapping(
  headers: string[],
  scoreLabels: string[],
  saved: ColumnMapping | null
): ColumnMapping {
  // If we have a saved mapping and all indices are within bounds, use it
  if (saved) {
    const maxCol = headers.length - 1;
    const allValid =
      saved.idNumber <= maxCol &&
      (saved.result === UNMAPPED || saved.result <= maxCol) &&
      (saved.note === UNMAPPED || saved.note <= maxCol) &&
      saved.grades.every((g) => g === UNMAPPED || g <= maxCol);
    if (allValid) return saved;
  }

  const lower = headers.map((h) => h.toLowerCase().trim());

  function findCol(hints: string[]): number {
    for (const hint of hints) {
      const idx = lower.findIndex((h) => h.includes(hint.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return UNMAPPED;
  }

  const idNumber = findCol(ID_HINTS);
  const result = findCol(RESULT_HINTS);
  const note = findCol(NOTE_HINTS);

  const grades: (number | -1)[] = scoreLabels.map((label) => {
    const idx = lower.findIndex((h) => h.includes(label.toLowerCase()));
    return idx >= 0 ? idx : UNMAPPED;
  });

  return {
    idNumber: idNumber >= 0 ? idNumber : 0,
    result,
    note,
    grades,
  };
}

// ---------------------------------------------------------------------------
// Parse rows using the column mapping
// ---------------------------------------------------------------------------

function parseRows(
  dataRows: (string | number | boolean | null)[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
  soldiersByIdNumber: Map<string, SoldierInfo>,
  scoreLabels: string[]
): ParsedReportRow[] {
  const seenIdNumbers = new Set<string>();

  return dataRows
    .map((row, i) => {
      const get = (idx: number) =>
        idx >= 0 && idx < row.length ? String(row[idx] ?? "").trim() : "";

      const idNumberRaw = get(mapping.idNumber);
      const resultRaw = get(mapping.result);
      const noteRaw = mapping.note !== UNMAPPED ? get(mapping.note) : null;

      // Skip completely empty rows
      if (!idNumberRaw && !resultRaw) return null;

      const errors: string[] = [];

      // Resolve soldier
      if (!idNumberRaw) {
        errors.push("מספר אישי חסר");
      } else if (seenIdNumbers.has(idNumberRaw)) {
        errors.push(`מספר אישי כפול: "${idNumberRaw}"`);
      }
      seenIdNumbers.add(idNumberRaw);

      const soldier = idNumberRaw ? soldiersByIdNumber.get(idNumberRaw) : undefined;
      if (idNumberRaw && !soldier) {
        errors.push(`חייל לא נמצא: "${idNumberRaw}"`);
      }

      // Parse result
      let result: ActivityResult | null = null;
      if (resultRaw) {
        const normalized = resultRaw.toLowerCase().trim();
        result = RESULT_MAP[normalized] ?? null;
        if (!result) {
          errors.push(`תוצאה לא חוקית: "${resultRaw}"`);
        }
      }

      // Parse grades
      const grades: (number | null)[] = mapping.grades.map((colIdx, scoreIdx) => {
        if (colIdx === UNMAPPED) return null;
        const raw = get(colIdx);
        if (!raw) return null;
        const num = Number(raw);
        if (isNaN(num)) {
          errors.push(`${scoreLabels[scoreIdx]}: ערך לא חוקי "${raw}"`);
          return null;
        }
        if (num < 0 || num > 100) {
          errors.push(`${scoreLabels[scoreIdx]}: ערך מחוץ לטווח (0-100)`);
          return null;
        }
        return num;
      });

      return {
        rowIndex: i + headerRowIndex + 2,
        idNumberRaw,
        soldierId: soldier?.id ?? null,
        soldierName: soldier
          ? `${soldier.familyName} ${soldier.givenName}`
          : null,
        result,
        grades,
        note: noteRaw || null,
        errors,
      } as ParsedReportRow;
    })
    .filter((r): r is ParsedReportRow => r !== null);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BulkImportReportsDialog({
  open,
  onOpenChange,
  activityId,
  activityTypeId,
  scoreLabels,
  soldiers,
  existingReports,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<(string | number | boolean | null)[][]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({
    idNumber: 0,
    result: UNMAPPED,
    note: UNMAPPED,
    grades: scoreLabels.map(() => UNMAPPED),
  });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Build soldier lookup by idNumber
  const soldiersByIdNumber = useMemo(() => {
    const map = new Map<string, SoldierInfo>();
    for (const s of soldiers) {
      if (s.idNumber) map.set(s.idNumber, s);
    }
    return map;
  }, [soldiers]);

  // Column options for the mapping dropdowns
  const columnOptions = useMemo(
    () => headers.map((h, i) => ({ index: i, label: h || `עמודה ${i + 1}` })),
    [headers]
  );

  // Parse rows whenever mapping or data changes
  const parsedRows = useMemo(() => {
    if (dataRows.length === 0) return [];
    return parseRows(dataRows, headerRowIndex, mapping, soldiersByIdNumber, scoreLabels);
  }, [dataRows, headerRowIndex, mapping, soldiersByIdNumber, scoreLabels]);

  const validRows = parsedRows.filter((r) => r.errors.length === 0);
  const errorRows = parsedRows.filter((r) => r.errors.length > 0);

  function reset() {
    setFileName("");
    setHeaders([]);
    setDataRows([]);
    setHeaderRowIndex(0);
    setImportError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
          sheet,
          { header: 1, raw: true }
        );

        if (rows.length < 2) {
          setImportError("הקובץ ריק או חסר שורות נתונים");
          return;
        }

        // Auto-detect header row (first 5 rows)
        let hIdx = 0;
        for (let i = 0; i < Math.min(rows.length, 5); i++) {
          const cells = rows[i].map((c) => String(c ?? "").trim().toLowerCase());
          if (
            ID_HINTS.some((hint) => cells.some((c) => c.includes(hint.toLowerCase()))) ||
            RESULT_HINTS.some((hint) => cells.some((c) => c.includes(hint.toLowerCase())))
          ) {
            hIdx = i;
            break;
          }
        }

        const hdrs = rows[hIdx].map((c) => String(c ?? "").trim());
        setHeaders(hdrs);
        setHeaderRowIndex(hIdx);
        setDataRows(rows.slice(hIdx + 1));

        // Load saved mapping or auto-detect
        const saved = loadMapping(activityTypeId);
        const detected = autoDetectMapping(hdrs, scoreLabels, saved);
        setMapping(detected);
      } catch {
        setImportError("לא ניתן לקרוא את הקובץ");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function updateMapping(field: keyof ColumnMapping | `grade_${number}`, value: number) {
    setMapping((prev) => {
      let next: ColumnMapping;
      if (typeof field === "string" && field.startsWith("grade_")) {
        const idx = parseInt(field.split("_")[1], 10);
        const grades = [...prev.grades];
        grades[idx] = value;
        next = { ...prev, grades };
      } else {
        next = { ...prev, [field]: value };
      }
      saveMapping(activityTypeId, next);
      return next;
    });
  }

  async function handleImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    setImportError(null);

    try {
      const updatedReports = new Map<string, SoldierReport>();

      for (const row of validRows) {
        if (!row.soldierId) continue;

        const existing = existingReports.get(row.soldierId);
        const report: SoldierReport = {
          id: existing?.id ?? null,
          result: row.result ?? existing?.result ?? null,
          grade1: row.grades[0] ?? existing?.grade1 ?? null,
          grade2: row.grades[1] ?? existing?.grade2 ?? null,
          grade3: row.grades[2] ?? existing?.grade3 ?? null,
          grade4: row.grades[3] ?? existing?.grade4 ?? null,
          grade5: row.grades[4] ?? existing?.grade5 ?? null,
          grade6: row.grades[5] ?? existing?.grade6 ?? null,
          note: row.note ?? existing?.note ?? null,
        };
        updatedReports.set(row.soldierId, report);
      }

      await onImport(updatedReports);
      reset();
    } catch {
      setImportError("שגיאה בייבוא הדיווחים");
    } finally {
      setImporting(false);
    }
  }

  const hasFile = headers.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>ייבוא דיווחים מקובץ</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-1">
          {/* File upload */}
          <div className="space-y-1.5">
            <Label>קובץ Excel / CSV</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFile}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="flex-1"
              >
                <Upload size={14} className="me-1.5" />
                {fileName || "בחר קובץ"}
              </Button>
              {hasFile && (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  נקה
                </Button>
              )}
            </div>
          </div>

          {/* Column mapping */}
          {hasFile && (
            <div className="space-y-3">
              <p className="text-sm font-medium">שיוך עמודות</p>

              {/* ID Number (required) */}
              <MappingSelect
                label="מספר אישי"
                required
                value={mapping.idNumber}
                options={columnOptions}
                onChange={(v) => updateMapping("idNumber", v)}
              />

              {/* Result */}
              <MappingSelect
                label="תוצאה (עבר/נכשל/לא רלוונטי)"
                value={mapping.result}
                options={columnOptions}
                onChange={(v) => updateMapping("result", v)}
              />

              {/* Score columns (dynamic) */}
              {scoreLabels.map((label, i) => (
                <MappingSelect
                  key={i}
                  label={label}
                  value={mapping.grades[i] ?? UNMAPPED}
                  options={columnOptions}
                  onChange={(v) => updateMapping(`grade_${i}`, v)}
                />
              ))}

              {/* Note */}
              <MappingSelect
                label="הערה"
                value={mapping.note}
                options={columnOptions}
                onChange={(v) => updateMapping("note", v)}
              />
            </div>
          )}

          {/* Preview table */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {parsedRows.length} שורות
                  {errorRows.length > 0 && (
                    <span className="text-destructive me-1">
                      {" "}
                      ({errorRows.length} שגיאות)
                    </span>
                  )}
                </p>
                {validRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {validRows.length} יוובאו
                  </p>
                )}
              </div>

              <div className="rounded-md border overflow-x-auto text-sm">
                <table className="w-full min-w-[360px]">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs">
                      <th className="text-end px-2 py-1.5 font-medium">#</th>
                      <th className="text-end px-2 py-1.5 font-medium">מ.א.</th>
                      <th className="text-end px-2 py-1.5 font-medium">חייל</th>
                      <th className="text-end px-2 py-1.5 font-medium">תוצאה</th>
                      {scoreLabels.map((label, i) => (
                        <th key={i} className="text-end px-2 py-1.5 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={cn(
                          "border-b last:border-0",
                          row.errors.length > 0 && "bg-destructive/5"
                        )}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.rowIndex}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5",
                            !row.soldierId && "text-destructive font-medium"
                          )}
                        >
                          {row.idNumberRaw || "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          {row.soldierName ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.result === "passed"
                            ? "עבר"
                            : row.result === "failed"
                              ? "נכשל"
                              : row.result === "na"
                                ? "לא רלוונטי"
                                : "—"}
                        </td>
                        {scoreLabels.map((_, i) => (
                          <td
                            key={i}
                            className="px-2 py-1.5 text-muted-foreground"
                          >
                            {row.grades[i] != null ? row.grades[i] : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {errorRows.length > 0 && (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive space-y-1">
                  {errorRows.slice(0, 5).map((r) => (
                    <p key={r.rowIndex}>
                      שורה {r.rowIndex}: {r.errors.join(", ")}
                    </p>
                  ))}
                  {errorRows.length > 5 && (
                    <p>ועוד {errorRows.length - 5} שגיאות נוספות...</p>
                  )}
                  <p className="font-medium mt-1">שורות עם שגיאות לא יוובאו.</p>
                </div>
              )}
            </div>
          )}

          {hasFile && parsedRows.length === 0 && dataRows.length > 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              לא נמצאו שורות תקינות בקובץ
            </p>
          )}

          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={importing}
          >
            ביטול
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
          >
            {importing
              ? "מייבא..."
              : `ייבא ${validRows.length > 0 ? validRows.length : ""} דיווחים`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Mapping select helper
// ---------------------------------------------------------------------------

function MappingSelect({
  label,
  value,
  options,
  onChange,
  required = false,
}: {
  label: string;
  value: number;
  options: { index: number; label: string }[];
  onChange: (value: number) => void;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm min-w-[120px] shrink-0">
        {label}
        {required && <span className="text-destructive ms-0.5">*</span>}
      </span>
      <Select
        value={String(value)}
        onValueChange={(v) => v && onChange(Number(v))}
      >
        <SelectTrigger className="flex-1 h-8 text-sm">
          <SelectValue>
            {value === UNMAPPED
              ? "— לא משויך —"
              : options.find((o) => o.index === value)?.label ?? `עמודה ${value + 1}`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!required && (
            <SelectItem value={String(UNMAPPED)}>— לא משויך —</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.index} value={String(o.index)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
