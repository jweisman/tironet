"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ExternalLink, FileSpreadsheet, FolderOpen, FilePlus, Share, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";

const GoogleFilePicker = dynamic(
  () => import("@/components/reports/GoogleFilePicker").then((m) => m.GoogleFilePicker),
  { ssr: false }
);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  activityTypeIds?: string;
  dateRange?: string;
}

type TargetMode = "default" | "new" | "picked";

interface PickedFile {
  id: string;
  name: string;
}

export function SheetsExportDialog({
  open,
  onOpenChange,
  cycleId,
  activityTypeIds,
  dateRange,
}: Props) {
  // Export default state
  const [defaultFile, setDefaultFile] = useState<PickedFile | null>(null);
  const [loadingDefault, setLoadingDefault] = useState(true);

  // Selection state
  const [targetMode, setTargetMode] = useState<TargetMode>("new");
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string | null>(null);

  // Load the user's default export file when the dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingDefault(true);
    setResultUrl(null);
    setResultName(null);
    setPickedFile(null);
    setShowPicker(false);

    fetch("/api/reports/google/export-default?reportType=all-activity")
      .then((res) => res.json())
      .then((data) => {
        if (data.spreadsheetId) {
          setDefaultFile({ id: data.spreadsheetId, name: data.spreadsheetName });
          setTargetMode("default");
        } else {
          setDefaultFile(null);
          setTargetMode("new");
        }
      })
      .catch(() => {
        setDefaultFile(null);
        setTargetMode("new");
      })
      .finally(() => setLoadingDefault(false));
  }, [open]);

  const handlePickerSelect = useCallback((file: PickedFile) => {
    setPickedFile(file);
    setTargetMode("picked");
    setShowPicker(false);
  }, []);

  const handlePickerCancel = useCallback(() => {
    setShowPicker(false);
  }, []);

  const handlePickerError = useCallback((error: string) => {
    setShowPicker(false);
    if (error === "needsAuth") {
      // Redirect to Google OAuth
      window.location.href = `/api/reports/google/auth?cycleId=${cycleId}`;
      return;
    }
    toast.error(error);
  }, [cycleId]);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ cycleId });
      if (activityTypeIds) params.set("activityTypeIds", activityTypeIds);
      if (dateRange) params.set("dateRange", dateRange);

      // Determine target spreadsheet ID
      let targetId: string | undefined;
      if (targetMode === "default" && defaultFile) {
        targetId = defaultFile.id;
      } else if (targetMode === "picked" && pickedFile) {
        targetId = pickedFile.id;
      }
      if (targetId) params.set("spreadsheetId", targetId);

      const res = await fetch(`/api/reports/all-activity/sheets?${params}`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.needsAuth) {
        window.location.href = data.authUrl;
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Export failed");
      }

      if (data.fileFallback) {
        toast.warning("הקובץ הקודם לא נמצא — נוצר קובץ חדש");
      }

      setResultUrl(data.url);
      setResultName(data.spreadsheetName);
    } catch {
      toast.error("שגיאה בהפקת הדוח");
    } finally {
      setExporting(false);
    }
  }

  function handleClose() {
    onOpenChange(false);
  }

  const isStandalone = typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
     ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone));
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (!resultUrl) return;
    try {
      await navigator.share({ title: resultName ?? "דוח פעילויות", url: resultUrl });
    } catch {
      // User cancelled share sheet — ignore
    }
  }

  async function handleCopy() {
    if (!resultUrl) return;
    await navigator.clipboard.writeText(resultUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // Confirmation phase
  if (resultUrl) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>הדוח הופק בהצלחה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-1">
              <p className="font-medium">{resultName}</p>
              <p className="text-muted-foreground text-xs break-all" dir="ltr">
                {resultUrl}
              </p>
            </div>

            {isStandalone ? (
              // PWA: direct link opens in-app browser without cookies — use share/copy instead
              <div className="flex gap-2">
                {canShare && (
                  <Button className="flex-1" onClick={handleShare}>
                    <Share size={16} className="me-1.5" />
                    שתף
                  </Button>
                )}
                <Button variant={canShare ? "outline" : "default"} className="flex-1" onClick={handleCopy}>
                  {copied ? <Check size={16} className="me-1.5" /> : <Copy size={16} className="me-1.5" />}
                  {copied ? "הועתק" : "העתק קישור"}
                </Button>
              </div>
            ) : (
              // Regular browser: direct link works fine
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <ExternalLink size={16} />
                פתח ב-Google Sheets
              </a>
            )}

            <Button variant="ghost" className="w-full" onClick={handleClose}>
              סיום
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Target selection phase
  const selectedName =
    targetMode === "default"
      ? defaultFile?.name
      : targetMode === "picked"
      ? pickedFile?.name
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ייצוא ל-Google Sheets</DialogTitle>
        </DialogHeader>

        {loadingDefault ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              בחר קובץ יעד לדוח:
            </p>

            <div className="space-y-2">
              {/* Default file option */}
              {defaultFile && (
                <button
                  type="button"
                  onClick={() => setTargetMode("default")}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-start text-sm transition-colors ${
                    targetMode === "default"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <FileSpreadsheet
                    size={18}
                    className={targetMode === "default" ? "text-primary" : "text-muted-foreground"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{defaultFile.name}</p>
                    <p className="text-xs text-muted-foreground">קובץ קיים</p>
                  </div>
                </button>
              )}

              {/* Picked file option (only shown after picker selection, if different from default) */}
              {pickedFile && pickedFile.id !== defaultFile?.id && (
                <button
                  type="button"
                  onClick={() => setTargetMode("picked")}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-start text-sm transition-colors ${
                    targetMode === "picked"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <FileSpreadsheet
                    size={18}
                    className={targetMode === "picked" ? "text-primary" : "text-muted-foreground"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{pickedFile.name}</p>
                    <p className="text-xs text-muted-foreground">נבחר מ-Google Drive</p>
                  </div>
                </button>
              )}

              {/* New workbook option */}
              <button
                type="button"
                onClick={() => setTargetMode("new")}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-start text-sm transition-colors ${
                  targetMode === "new"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <FilePlus
                  size={18}
                  className={targetMode === "new" ? "text-primary" : "text-muted-foreground"}
                />
                <div>
                  <p className="font-medium">קובץ חדש</p>
                  <p className="text-xs text-muted-foreground">יצירת קובץ Google Sheets חדש</p>
                </div>
              </button>

              {/* Choose from Drive button */}
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border p-3 text-start text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <FolderOpen size={18} />
                <span>בחר מ-Google Drive...</span>
              </button>
            </div>

            {targetMode !== "new" && selectedName && (
              <p className="text-xs text-muted-foreground">
                הגיליונות הקיימים בקובץ יוחלפו בנתונים העדכניים.
              </p>
            )}

            <div className="flex flex-row-reverse gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                disabled={exporting}
              >
                ביטול
              </Button>
              <Button
                className="flex-1"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <>
                    <Loader2 size={16} className="animate-spin me-1.5" />
                    מפיק...
                  </>
                ) : (
                  "הפק דוח"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Google Picker (renders nothing, opens picker modal) */}
        {showPicker && (
          <GoogleFilePicker
            onSelect={handlePickerSelect}
            onCancel={handlePickerCancel}
            onError={handlePickerError}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
