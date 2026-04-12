"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { isValidIsraeliPhone } from "@/lib/phone";
import { Download, Upload } from "lucide-react";

type SoldierStatus = "active" | "transferred" | "dropped" | "injured";

interface SquadOption {
  id: string;
  name: string;
  platoonId: string;
  platoonName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  squads: SquadOption[];
  defaultSquadId?: string;
  existingIdNumbers?: Set<string>;
  onSuccess: (created: number, updated: number, activeActivityCount: number, soldierIds?: string[]) => void;
}

interface ParsedRow {
  rowIndex: number;
  familyName: string;
  givenName: string;
  idNumber: string;
  civilianId: string;
  rank: string;
  status: string;
  phone: string;
  emergencyPhone: string;
  platoonName: string;
  squadName: string;
  resolvedSquadId: string | null;
  isUpdate: boolean;
  errors: string[];
}

const VALID_STATUSES: Record<string, SoldierStatus> = {
  פעיל: "active",
  הועבר: "transferred",
  נשר: "dropped",
  פצוע: "injured",
  active: "active",
  transferred: "transferred",
  dropped: "dropped",
  injured: "injured",
};

const TEMPLATE_HEADERS = ["שם משפחה", "שם פרטי", "מספר אישי", "מספר זהות", "מחלקה", "כיתה", "דרגה", "סטטוס", "טלפון", "טלפון חירום"];

const FROM_FILE = "__from_file__";

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ["כהן", "דוד", "1234567", "123456789", "מחלקה א", "כיתה א", "טוראי", "פעיל", "0501234567", "0509876543"],
    ["לוי", "רחל", "", "", "", "", "", "", "", ""],
  ]);
  ws["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "חיילים");
  XLSX.writeFile(wb, "תבנית-חיילים.xlsx");
}

function parseSheet(
  workbook: XLSX.WorkBook,
  squads: SquadOption[],
  platoonMode: "select" | "file",
  squadMode: "select" | "file",
  existingIdNumbers?: Set<string>
): ParsedRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];

  if (rows.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map((c) => String(c ?? "").trim());
    if (cells.includes("שם משפחה") || cells.includes("שם פרטי")) {
      headerIdx = i;
      break;
    }
  }

  const headers = rows[headerIdx].map((c) => String(c ?? "").trim());
  const familyIdx = headers.findIndex((h) => h === "שם משפחה");
  const givenIdx = headers.findIndex((h) => h === "שם פרטי");
  const idNumberIdx = headers.findIndex((h) => h === "מספר אישי");
  const civilianIdIdx = headers.findIndex((h) => h === "מספר זהות");
  const platoonIdx = headers.findIndex((h) => h === "מחלקה");
  const squadIdx = headers.findIndex((h) => h === "כיתה");
  const rankIdx = headers.findIndex((h) => h === "דרגה");
  const statusIdx = headers.findIndex((h) => h === "סטטוס");
  const phoneIdx = headers.findIndex((h) => h === "טלפון");
  const emergencyPhoneIdx = headers.findIndex((h) => h === "טלפון חירום");

  // Build platoon name → id lookup (case-insensitive, trimmed)
  const platoonLookup = new Map<string, string>();
  for (const s of squads) {
    platoonLookup.set(s.platoonName.trim().toLowerCase(), s.platoonId);
  }

  // Build "platoonId:squadName" → id lookup (case-insensitive, trimmed)
  // When platoon is from file, squad must be resolved within the correct platoon
  const squadLookupByPlatoon = new Map<string, string>();
  const squadLookupGlobal = new Map<string, string>();
  for (const s of squads) {
    squadLookupByPlatoon.set(`${s.platoonId}:${s.name.trim().toLowerCase()}`, s.id);
    squadLookupGlobal.set(s.name.trim().toLowerCase(), s.id);
  }

  const dataRows = rows.slice(headerIdx + 1);
  const parsed: ParsedRow[] = [];

  dataRows.forEach((row, i) => {
    const get = (idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");
    const familyName = get(familyIdx);
    const givenName = get(givenIdx);
    const idNumber = get(idNumberIdx);
    const civilianId = get(civilianIdIdx);
    const platoonName = get(platoonIdx);
    const squadName = get(squadIdx);
    const rank = get(rankIdx);
    const status = get(statusIdx);
    const phone = get(phoneIdx);
    const emergencyPhone = get(emergencyPhoneIdx);

    if (!familyName && !givenName && !rank && !status && !idNumber && !squadName && !platoonName && !phone && !emergencyPhone) return;

    const errors: string[] = [];
    if (!familyName) errors.push("שם משפחה חסר");
    if (!givenName) errors.push("שם פרטי חסר");
    if (status && !VALID_STATUSES[status]) {
      errors.push(`סטטוס לא חוקי: "${status}"`);
    }
    if (phone && !isValidIsraeliPhone(phone)) {
      errors.push(`טלפון לא תקין: "${phone}"`);
    }
    if (emergencyPhone && !isValidIsraeliPhone(emergencyPhone)) {
      errors.push(`טלפון חירום לא תקין: "${emergencyPhone}"`);
    }

    // Resolve platoon from file when in platoon-from-file mode
    let resolvedPlatoonId: string | null = null;
    if (platoonMode === "file") {
      if (!platoonName) {
        errors.push("מחלקה חסרה");
      } else {
        resolvedPlatoonId = platoonLookup.get(platoonName.toLowerCase()) ?? null;
        if (!resolvedPlatoonId) {
          errors.push(`מחלקה לא נמצאה: "${platoonName}"`);
        }
      }
    }

    let resolvedSquadId: string | null = null;
    if (squadMode === "file") {
      if (!squadName) {
        errors.push("כיתה חסרה");
      } else if (platoonMode === "file" && resolvedPlatoonId) {
        // Squad must exist within the resolved platoon
        resolvedSquadId = squadLookupByPlatoon.get(`${resolvedPlatoonId}:${squadName.toLowerCase()}`) ?? null;
        if (!resolvedSquadId) {
          errors.push(`כיתה "${squadName}" לא נמצאה במחלקה "${platoonName}"`);
        }
      } else if (platoonMode === "select") {
        // Squad resolved within the filtered squads list (already filtered by platoon)
        resolvedSquadId = squadLookupGlobal.get(squadName.toLowerCase()) ?? null;
        if (!resolvedSquadId) {
          errors.push(`כיתה לא נמצאה: "${squadName}"`);
        }
      }
    }

    const isUpdate = !!(idNumber && existingIdNumbers?.has(idNumber));

    parsed.push({
      rowIndex: i + headerIdx + 2,
      familyName,
      givenName,
      idNumber,
      civilianId,
      rank,
      status,
      phone,
      emergencyPhone,
      platoonName,
      squadName,
      resolvedSquadId,
      isUpdate,
      errors,
    });
  });

  return parsed;
}

export function BulkImportDialog({
  open,
  onOpenChange,
  cycleId,
  squads,
  defaultSquadId,
  existingIdNumbers,
  onSuccess,
}: Props) {
  // Platoon filter — only shown when there are multiple platoons
  const platoons = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of squads) map.set(s.platoonId, s.platoonName);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [squads]);
  const showPlatoonSelector = !defaultSquadId && platoons.length > 1;

  const [platoonId, setPlatoonId] = useState("");
  const platoonMode = platoonId === FROM_FILE ? "file" : "select";
  const filteredSquads = useMemo(
    () => platoonId && platoonId !== FROM_FILE ? squads.filter((s) => s.platoonId === platoonId) : squads,
    [squads, platoonId]
  );

  const [squadId, setSquadId] = useState(defaultSquadId ?? "");
  // Sync squadId when squads arrive after initial mount (PowerSync async)
  useEffect(() => {
    if (!squadId && defaultSquadId && squads.length > 0) {
      setSquadId(defaultSquadId);
    }
  }, [squads, defaultSquadId, squadId]);

  // When platoon is "from file", force squad to "from file" too
  useEffect(() => {
    if (platoonId === FROM_FILE && squadId !== FROM_FILE) {
      setSquadId(FROM_FILE);
    }
  }, [platoonId, squadId]);

  // Reset squad when platoon filter changes and current selection is no longer valid
  useEffect(() => {
    if (platoonId && platoonId !== FROM_FILE && squadId && squadId !== FROM_FILE && filteredSquads.length > 0 && !filteredSquads.some((s) => s.id === squadId)) {
      setSquadId("");
    }
  }, [platoonId, filteredSquads, squadId]);

  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const squadMode = squadId === FROM_FILE ? "file" : "select";

  // Re-parse when squad/platoon mode or platoon filter changes
  useEffect(() => {
    if (workbook) {
      const parsed = parseSheet(workbook, platoonMode === "file" ? squads : filteredSquads, platoonMode, squadMode, existingIdNumbers);
      setRows(parsed);
    }
  }, [squadMode, platoonMode, workbook, filteredSquads, squads]);

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
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        setWorkbook(wb);
        const parsed = parseSheet(wb, platoonMode === "file" ? squads : filteredSquads, platoonMode, squadMode, existingIdNumbers);
        setRows(parsed);
      } catch {
        setImportError("לא ניתן לקרוא את הקובץ");
        setRows(null);
        setWorkbook(null);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (!rows) return;
    if (squadMode === "select" && !squadId) return;
    const validRows = rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/soldiers/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          soldiers: validRows.map((r) => ({
            squadId: squadMode === "file" ? r.resolvedSquadId : squadId,
            familyName: r.familyName,
            givenName: r.givenName,
            idNumber: r.idNumber || null,
            civilianId: r.civilianId || null,
            rank: r.rank || null,
            status: (VALID_STATUSES[r.status] ?? "active") as SoldierStatus,
            phone: r.phone || null,
            emergencyPhone: r.emergencyPhone || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setImportError(data.error ?? "שגיאה בייבוא");
        return;
      }
      const { created, updated, activeActivityCount, soldierIds } = await res.json();
      reset();
      onSuccess(created, updated, activeActivityCount, soldierIds);
    } catch {
      setImportError("שגיאה בייבוא");
    } finally {
      setImporting(false);
    }
  }

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? [];
  const errorRows = rows?.filter((r) => r.errors.length > 0) ?? [];
  const newRows = validRows.filter((r) => !r.isUpdate);
  const updateRows = validRows.filter((r) => r.isUpdate);
  const hasErrors = errorRows.length > 0;
  const canImport = rows && validRows.length > 0 && (squadMode === "file" || squadId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>ייבוא חיילים מקובץ</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-1">
          {/* Platoon selector — only for company commanders / admins with multiple platoons */}
          {showPlatoonSelector && (
            <div className="space-y-1.5">
              <Label>מחלקה</Label>
              <Select
                value={platoonId || "__all__"}
                onValueChange={(v) => setPlatoonId(!v || v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="כל המחלקות">
                    {platoonId === FROM_FILE
                      ? "מהקובץ"
                      : platoons.find((p) => p.id === platoonId)?.name ?? "כל המחלקות"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">כל המחלקות</SelectItem>
                  <SelectItem value={FROM_FILE}>מהקובץ</SelectItem>
                  {platoons.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {platoonId === FROM_FILE && (
                <p className="text-xs text-muted-foreground">
                  המחלקה והכיתה ייקראו מהקובץ. השמות חייבים להתאים בדיוק לשמות במערכת.
                </p>
              )}
            </div>
          )}

          {/* Squad selector — disabled when platoon is "from file" */}
          {!defaultSquadId && squads.length >= 1 && (
            <div className="space-y-1.5">
              <Label>כיתה</Label>
              <Select
                value={squadId}
                onValueChange={(v) => v && setSquadId(v)}
                disabled={platoonMode === "file"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="בחר כיתה">
                    {squadId === FROM_FILE
                      ? "מהקובץ"
                      : filteredSquads.find((s) => s.id === squadId)?.name ?? "בחר כיתה"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FROM_FILE}>מהקובץ</SelectItem>
                  {filteredSquads.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {squadId === FROM_FILE && platoonMode !== "file" && (
                <p className="text-xs text-muted-foreground">
                  הכיתה תיקרא מעמודת &quot;כיתה&quot; בקובץ. השם חייב להתאים בדיוק לשם הכיתה במערכת.
                </p>
              )}
            </div>
          )}

          {/* Template download */}
          <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
            <div>
              <p className="text-sm font-medium">תבנית Excel</p>
              <p className="text-xs text-muted-foreground">הורד תבנית עם העמודות הנדרשות</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download size={14} className="me-1.5" />
              הורדה
            </Button>
          </div>

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
                  {rows.length} שורות
                  {hasErrors && (
                    <span className="text-destructive me-1"> ({errorRows.length} שגיאות)</span>
                  )}
                </p>
                {validRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {newRows.length > 0 && `${newRows.length} חדשים`}
                    {newRows.length > 0 && updateRows.length > 0 && ", "}
                    {updateRows.length > 0 && `${updateRows.length} עדכונים`}
                  </p>
                )}
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  לא נמצאו שורות בקובץ
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto text-sm">
                  <table className="w-full min-w-[360px]">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs">
                        <th className="text-end px-2 py-1.5 font-medium">#</th>
                        <th className="text-end px-2 py-1.5 font-medium">שם משפחה</th>
                        <th className="text-end px-2 py-1.5 font-medium">שם פרטי</th>
                        <th className="text-end px-2 py-1.5 font-medium">מ.א.</th>
                        {platoonMode === "file" && (
                          <th className="text-end px-2 py-1.5 font-medium">מחלקה</th>
                        )}
                        {squadMode === "file" && (
                          <th className="text-end px-2 py-1.5 font-medium">כיתה</th>
                        )}
                        <th className="text-end px-2 py-1.5 font-medium">דרגה</th>
                        <th className="text-end px-2 py-1.5 font-medium">סטטוס</th>
                        {updateRows.length > 0 && (
                          <th className="text-end px-2 py-1.5 font-medium">פעולה</th>
                        )}
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
                              !row.familyName && "text-destructive font-medium"
                            )}
                          >
                            {row.familyName || "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5",
                              !row.givenName && "text-destructive font-medium"
                            )}
                          >
                            {row.givenName || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {row.idNumber || "—"}
                          </td>
                          {platoonMode === "file" && (
                            <td
                              className={cn(
                                "px-2 py-1.5",
                                !row.platoonName && "text-destructive font-medium"
                              )}
                            >
                              {row.platoonName || "—"}
                            </td>
                          )}
                          {squadMode === "file" && (
                            <td
                              className={cn(
                                "px-2 py-1.5",
                                row.squadName && !row.resolvedSquadId && "text-destructive font-medium",
                                !row.squadName && "text-destructive font-medium"
                              )}
                            >
                              {row.squadName || "—"}
                            </td>
                          )}
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {row.rank || "—"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5",
                              row.status && !VALID_STATUSES[row.status] && "text-destructive"
                            )}
                          >
                            {row.status || "פעיל"}
                          </td>
                          {updateRows.length > 0 && (
                            <td className="px-2 py-1.5 text-xs">
                              {row.isUpdate ? (
                                <span className="text-amber-500">עדכון</span>
                              ) : (
                                <span className="text-green-500">חדש</span>
                              )}
                            </td>
                          )}
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
                    <p>ועוד {errorRows.length - 5} שגיאות נוספות...</p>
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
            {importing
              ? "מייבא..."
              : updateRows.length > 0
                ? `ייבא ${newRows.length} חדשים, עדכן ${updateRows.length}`
                : `ייבא ${validRows.length > 0 ? validRows.length : ""} חיילים`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
