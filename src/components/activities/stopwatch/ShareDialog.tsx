"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, QrCode, ScanLine } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hebrewCount } from "@/lib/utils/hebrew-count";
import {
  PAYLOAD_VERSION,
  decodePayload,
  encodePayload,
  type TransferPayload,
} from "@/lib/stopwatch/transfer";
import type { Lap } from "@/lib/stopwatch/state";
import { QRScanner } from "./QRScanner";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string;
  scoreKey: string;
  /** The current lap list — only unassigned laps are still in here, so this is what we share. */
  laps: Lap[];
  /** Receiver flow: replace local laps with these. */
  onImport: (laps: Array<{ number: number; elapsedMs: number }>) => void;
  /** True when the receiver already has data we'd be discarding on import. */
  hasExistingState: boolean;
}

type View = "menu" | "show" | "scan";

/**
 * Wrapper that mounts `ShareDialogInner` only while open. The internal view
 * state (menu/show/scan, QR data URL, scan error, etc.) is therefore freshly
 * initialised on every open without needing a setState-in-effect reset path.
 */
export function ShareDialog(props: ShareDialogProps) {
  if (!props.open) return null;
  return <ShareDialogInner {...props} />;
}

function ShareDialogInner({
  open,
  onOpenChange,
  activityId,
  scoreKey,
  laps,
  onImport,
  hasExistingState,
}: ShareDialogProps) {
  const [view, setView] = useState<View>("menu");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<TransferPayload | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Generate the QR when entering the show view.
  useEffect(() => {
    if (view !== "show") return;
    let cancelled = false;
    const payload: TransferPayload = {
      version: PAYLOAD_VERSION,
      activityId,
      scoreKey,
      laps: laps.map((l) => ({ number: l.number, elapsedMs: l.elapsedMs })),
    };
    const text = encodePayload(payload);
    // Error-correction level "L" (low, ~7% redundancy) over "M" — we're
    // going screen-to-camera with a clean source image, so M's extra
    // redundancy buys nothing useful and costs ~17% in capacity.
    // Source resolution 600px keeps the rendered QR sharp even on
    // 2–3× DPI displays after the browser scales it down to fit the dialog.
    QRCode.toDataURL(text, { errorCorrectionLevel: "L", margin: 2, width: 600 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrError("שגיאה ביצירת קוד QR");
      });
    return () => {
      cancelled = true;
    };
  }, [view, activityId, scoreKey, laps]);

  function handleScan(raw: string) {
    const payload = decodePayload(raw);
    if (!payload) {
      setScanError("קוד QR לא תקין");
      return;
    }
    if (payload.activityId !== activityId || payload.scoreKey !== scoreKey) {
      setScanError("הקוד שייך לפעילות או לציון אחר");
      return;
    }
    if (hasExistingState) {
      setPendingImport(payload);
      return;
    }
    onImport(payload.laps);
    toast.success(`יובאו ${hebrewCount(payload.laps.length, "זמן", "זמנים")}`);
    onOpenChange(false);
  }

  function confirmImport() {
    if (!pendingImport) return;
    onImport(pendingImport.laps);
    toast.success(`יובאו ${hebrewCount(pendingImport.laps.length, "זמן", "זמנים")}`);
    setPendingImport(null);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {view === "menu" && "שיתוף זמנים"}
              {view === "show" && "הצג קוד QR"}
              {view === "scan" && "סרוק קוד QR"}
            </DialogTitle>
            <DialogDescription>
              {view === "menu" && "העברת זמנים שטרם הוקצו למכשיר אחר באמצעות קוד QR"}
              {view === "show" && "סרוק את הקוד מהמכשיר השני"}
              {view === "scan" && "כוון את המצלמה אל הקוד שמוצג במכשיר השני"}
            </DialogDescription>
          </DialogHeader>

          {view === "menu" && (
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => setView("show")}
                disabled={laps.length === 0}
                className="justify-start"
              >
                <QrCode size={16} className="me-2" />
                הצג QR ({hebrewCount(laps.length, "זמן", "זמנים")})
              </Button>
              <Button variant="outline" onClick={() => setView("scan")} className="justify-start">
                <ScanLine size={16} className="me-2" />
                סרוק QR
              </Button>
              {laps.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  אין זמנים להעביר
                </p>
              )}
            </div>
          )}

          {view === "show" && (
            <div className="flex flex-col items-center gap-3">
              {qrError ? (
                <p className="text-sm text-destructive">{qrError}</p>
              ) : qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="QR"
                  className="w-full rounded-md border border-border bg-white"
                />
              ) : (
                <div className="w-full aspect-square rounded-md border border-border bg-muted animate-pulse" />
              )}
              <p className="text-xs text-muted-foreground text-center">
                {hebrewCount(laps.length, "זמן זמין", "זמנים זמינים")} להעברה
              </p>
            </div>
          )}

          {view === "scan" && (
            <div className="flex flex-col gap-2">
              <QRScanner
                onDetect={handleScan}
                onError={(m) => setScanError(m)}
              />
              {scanError && (
                <p className="text-sm text-destructive text-center">{scanError}</p>
              )}
            </div>
          )}

          <DialogFooter>
            {view === "menu" ? (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                סגור
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setView("menu");
                  setScanError(null);
                  setQrError(null);
                }}
              >
                <ArrowLeft size={14} className="me-1" />
                חזור
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm replacing existing state on receive. */}
      <Dialog
        open={pendingImport !== null}
        onOpenChange={(o) => !o && setPendingImport(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>החלפת זמנים מקומיים</DialogTitle>
            <DialogDescription>
              {pendingImport
                ? `יבוא של ${hebrewCount(pendingImport.laps.length, "זמן", "זמנים")} ימחק את הזמנים הקיימים במכשיר זה ויאפס את הסטופר. להמשיך?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingImport(null)}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={confirmImport}>
              החלף
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
