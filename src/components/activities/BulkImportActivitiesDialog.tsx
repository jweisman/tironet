"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { readSpreadsheet } from "@/lib/utils/spreadsheet";
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
import { hebrewCount } from "@/lib/utils/hebrew-count";
import { Download, Upload } from "lucide-react";

interface ActivityType {
  id: string;
  name: string;
  icon: string;
}

interface PlatoonOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  platoonOptions: PlatoonOption[];
  onSuccess: (created: number, skipped: number) => void;
}

interface ParsedRow {
  rowIndex: number;
  activityTypeName: string;
  resolvedActivityTypeId: string | null;
  name: string;
  date: string;
  isRequired: boolean;
  errors: string[];
}

const VALID_REQUIRED: Record<string, boolean> = {
  כן: true,
  לא: false,
  yes: true,
  no: false,
  true: true,
  false: false,
};

const TEMPLATE_HEADERS = ["סוג פעילות", "שם", "תאריך", "חובה"];

function downloadTemplate(activityTypes: ActivityType[]) {
  const type1 = activityTypes[0]?.name ?? "ירי";
  const type2 = activityTypes[1]?.name ?? 'כש"ג';
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [type1, `${type1} יום 1`, "2026-04-01", "כן"],
    [type2, `${type2} מסכם`],
  ]);
  ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, "פעילויות");
  XLSX.writeFile(wb, "תבנית-פעילויות.xlsx");
}

function parseSheet(
  workbook: XLSX.WorkBook,
  activityTypes: ActivityType[]
): ParsedRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw: true so date cells arrive as Excel serial numbers (not pre-formatted)
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: true,
  });

  if (rows.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map((c) => String(c ?? "").trim());
    if (cells.includes("סוג פעילות") || cells.includes("שם")) {
      headerIdx = i;
      break;
    }
  }

  const headers = rows[headerIdx].map((c) => String(c ?? "").trim());
  const typeIdx = headers.findIndex((h) => h === "סוג פעילות");
  const nameIdx = headers.findIndex((h) => h === "שם");
  const dateIdx = headers.findIndex((h) => h === "תאריך");
  const requiredIdx = headers.findIndex((h) => h === "חובה");
  // Build type name → id lookup (case-insensitive, trimmed)
  const typeLookup = new Map<string, string>();
  for (const t of activityTypes) {
    typeLookup.set(t.name.trim().toLowerCase(), t.id);
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const dataRows = rows.slice(headerIdx + 1);
  const parsed: ParsedRow[] = [];

  dataRows.forEach((row, i) => {
    const get = (idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");
    const getRaw = (idx: number) => (idx >= 0 ? row[idx] ?? null : null);
    const activityTypeName = get(typeIdx);
    const name = get(nameIdx);
    const dateRawValue = getRaw(dateIdx);
    const dateRaw = dateRawValue != null ? String(dateRawValue).trim() : "";
    const requiredRaw = get(requiredIdx);
    // Skip completely empty rows
    if (!activityTypeName && !name && !dateRaw && !requiredRaw) return;

    const errors: string[] = [];

    // Validate activity type (required)
    if (!activityTypeName) {
      errors.push("סוג פעילות חסר");
    }
    const resolvedActivityTypeId = activityTypeName
      ? typeLookup.get(activityTypeName.toLowerCase()) ?? null
      : null;
    if (activityTypeName && !resolvedActivityTypeId) {
      errors.push(`סוג פעילות לא נמצא: "${activityTypeName}"`);
    }

    // Validate name (required)
    if (!name) {
      errors.push("שם חסר");
    }

    // Validate date (optional, default today)
    let date = todayStr;
    if (dateRaw) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        date = dateRaw;
      } else if (typeof dateRawValue === "number") {
        // Excel date serial number — convert via XLSX utility
        const dt = XLSX.SSF.parse_date_code(dateRawValue);
        if (dt) {
          date = `${String(dt.y).padStart(4, "0")}-${String(dt.m).padStart(2, "0")}-${String(dt.d).padStart(2, "0")}`;
        } else {
          errors.push(`תאריך לא חוקי: "${dateRaw}"`);
        }
      } else {
        errors.push(`תאריך לא חוקי: "${dateRaw}"`);
      }
    }

    // Validate required (optional, default true)
    let isRequired = true;
    if (requiredRaw) {
      const normalized = requiredRaw.toLowerCase();
      if (normalized in VALID_REQUIRED) {
        isRequired = VALID_REQUIRED[normalized];
      } else {
        errors.push(`ערך חובה לא חוקי: "${requiredRaw}"`);
      }
    }

    parsed.push({
      rowIndex: i + headerIdx + 2,
      activityTypeName,
      resolvedActivityTypeId,
      name,
      date,
      isRequired,
      errors,
    });
  });

  return parsed;
}

export function BulkImportActivitiesDialog({
  open,
  onOpenChange,
  cycleId,
  platoonOptions,
  onSuccess,
}: Props) {
  const [platoonId, setPlatoonId] = useState(
    platoonOptions.length === 1 ? platoonOptions[0].id : ""
  );

  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch activity types when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingTypes(true);
    fetch("/api/activity-types")
      .then((r) => r.json())
      .then((data: ActivityType[]) => setActivityTypes(data))
      .catch(() => setActivityTypes([]))
      .finally(() => setLoadingTypes(false));
  }, [open]);

  // Re-parse when activity types load after file was already uploaded
  useEffect(() => {
    if (workbook && activityTypes.length > 0) {
      setRows(parseSheet(workbook, activityTypes));
    }
  }, [activityTypes, workbook]);

  function reset() {
    setRows(null);
    setFileName("");
    setImportError(null);
    setWorkbook(null);
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
        const data = ev.target?.result as ArrayBuffer;
        const wb = readSpreadsheet(data, file.name);
        setWorkbook(wb);
        setRows(parseSheet(wb, activityTypes));
      } catch {
        setImportError("לא ניתן לקרוא את הקובץ");
        setRows(null);
        setWorkbook(null);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (!rows || !platoonId) return;
    const validRows = rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    const targetIds = platoonId === "__all__"
      ? platoonOptions.map((p) => p.id)
      : [platoonId];

    setImporting(true);
    setImportError(null);
    try {
      let totalCreated = 0;
      let totalSkipped = 0;
      for (const pid of targetIds) {
        const res = await fetch("/api/activities/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cycleId,
            platoonId: pid,
            activities: validRows.map((r) => ({
              activityTypeId: r.resolvedActivityTypeId,
              name: r.name,
              date: r.date,
              isRequired: r.isRequired,
            })),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setImportError(data.error ?? "שגיאה בייבוא");
          return;
        }
        const { created, skipped } = await res.json();
        totalCreated += created;
        totalSkipped += skipped;
      }
      reset();
      onSuccess(totalCreated, totalSkipped);
    } catch {
      setImportError("שגיאה בייבוא");
    } finally {
      setImporting(false);
    }
  }

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? [];
  const errorRows = rows?.filter((r) => r.errors.length > 0) ?? [];
  const hasErrors = errorRows.length > 0;
  const canImport = rows && validRows.length > 0 && platoonId;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>ייבוא פעילויות מקובץ</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-1">
          {/* Platoon selector */}
          {platoonOptions.length > 1 && (
            <div className="space-y-1.5">
              <Label>מחלקה</Label>
              <Select value={platoonId} onValueChange={(v) => v && setPlatoonId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="בחר מחלקה">
                    {platoonId === "__all__"
                      ? "כל המחלקות"
                      : platoonOptions.find((p) => p.id === platoonId)?.name ?? "בחר מחלקה"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">כל המחלקות</SelectItem>
                  {platoonOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Template download */}
          <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
            <div>
              <p className="text-sm font-medium">תבנית Excel</p>
              <p className="text-xs text-muted-foreground">הורד תבנית עם העמודות הנדרשות</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => downloadTemplate(activityTypes)}>
              <Download size={14} className="me-1.5" />
              הורדה
            </Button>
          </div>

          {/* File upload */}
          <div className="space-y-1.5">
            <Label>קובץ Excel / CSV</Label>
            {loadingTypes && (
              <p className="text-xs text-muted-foreground">טוען סוגי פעילויות...</p>
            )}
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
              {rows && (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  נקה
                </Button>
              )}
            </div>
          </div>

          {/* Preview table */}
          {rows !== null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {hebrewCount(rows.length, "שורה", "שורות")}
                  {hasErrors && (
                    <span className="text-destructive me-1"> ({hebrewCount(errorRows.length, "שגיאה", "שגיאות")})</span>
                  )}
                </p>
                {validRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">{validRows.length} יוובאו</p>
                )}
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  לא נמצאו שורות בקובץ
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto text-sm">
                  <table className="w-full min-w-[420px]">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs">
                        <th className="text-end px-2 py-1.5 font-medium">#</th>
                        <th className="text-end px-2 py-1.5 font-medium">סוג פעילות</th>
                        <th className="text-end px-2 py-1.5 font-medium">שם</th>
                        <th className="text-end px-2 py-1.5 font-medium">תאריך</th>
                        <th className="text-end px-2 py-1.5 font-medium">חובה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.rowIndex}
                          className={cn(
                            "border-b last:border-0",
                            row.errors.length > 0 && "bg-destructive/5"
                          )}
                        >
                          <td className="px-2 py-1.5 text-muted-foreground">{row.rowIndex}</td>
                          <td
                            className={cn(
                              "px-2 py-1.5",
                              (!row.activityTypeName || !row.resolvedActivityTypeId) &&
                                "text-destructive font-medium"
                            )}
                          >
                            {row.activityTypeName || "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5",
                              !row.name && "text-destructive font-medium"
                            )}
                          >
                            {row.name || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {row.date}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {row.isRequired ? "כן" : "לא"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {hasErrors && (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive space-y-1">
                  {errorRows.slice(0, 5).map((r) => (
                    <p key={r.rowIndex}>
                      שורה {r.rowIndex}: {r.errors.join(", ")}
                    </p>
                  ))}
                  {errorRows.length > 5 && (
                    <p>ועוד {hebrewCount(errorRows.length - 5, "שגיאה נוספת", "שגיאות נוספות")}...</p>
                  )}
                  <p className="font-medium mt-1">שורות עם שגיאות לא יוובאו.</p>
                </div>
              )}
            </div>
          )}

          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={importing}>
            ביטול
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={importing || !canImport}
          >
            {importing ? "מייבא..." : `ייבא ${validRows.length > 0 ? hebrewCount(validRows.length, "פעילות", "פעילויות") : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
