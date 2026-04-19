"use client";

import { useState, useEffect, useRef } from "react";
import imageCompression from "browser-image-compression";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  file: File | null;
  onConfirm: (base64: string) => void;
  onCancel: () => void;
}

export function LogoCropDialog({ file, onConfirm, onCancel }: Props) {
  const [imgSrc, setImgSrc] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const prevFileRef = useRef<File | null>(null);

  useEffect(() => {
    if (!file || file === prevFileRef.current) return;
    prevFileRef.current = file;
    const reader = new FileReader();
    reader.onload = (e) => setImgSrc(e.target?.result as string);
    reader.readAsDataURL(file);
  }, [file]);

  async function handleConfirm() {
    if (!file) return;
    setProcessing(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.1,
        maxWidthOrHeight: 200,
        useWebWorker: true,
      });
      const reader = new FileReader();
      reader.onload = () => {
        setProcessing(false);
        onConfirm(reader.result as string);
      };
      reader.readAsDataURL(compressed);
    } catch {
      setProcessing(false);
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>העלאת לוגו</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center p-4 bg-muted/30 rounded-lg min-h-40">
          {imgSrc && (
            <img
              src={imgSrc}
              alt="תצוגה מקדימה"
              className="max-h-40 max-w-full object-contain"
            />
          )}
        </div>

        <div className="flex flex-row-reverse gap-2 justify-end pt-1">
          <Button type="button" variant="outline" onClick={onCancel} disabled={processing}>
            ביטול
          </Button>
          <Button onClick={handleConfirm} disabled={!file || processing}>
            {processing ? "מעבד..." : "אשר"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
