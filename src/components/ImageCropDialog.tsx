"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
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

async function getCroppedBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas is empty"))),
      "image/webp",
      0.85
    );
  });
}

export function ImageCropDialog({ file, onConfirm, onCancel }: Props) {
  const [imgSrc, setImgSrc] = useState<string>("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const prevFileRef = useRef<File | null>(null);

  // Load file into data URL only when the file identity changes
  useEffect(() => {
    if (!file || file === prevFileRef.current) return;
    prevFileRef.current = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImgSrc(e.target?.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
  }, [file]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function handleConfirm() {
    if (!imgSrc || !croppedAreaPixels) return;
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imgSrc, croppedAreaPixels);
      const compressed = await imageCompression(
        new File([blob], "crop.webp", { type: "image/webp" }),
        { maxSizeMB: 0.1, maxWidthOrHeight: 400, useWebWorker: true }
      );
      const reader = new FileReader();
      reader.onload = () => onConfirm(reader.result as string);
      reader.readAsDataURL(compressed);
    } catch {
      setProcessing(false);
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>חתוך תמונה</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Crop area */}
          <div className="relative w-full" style={{ height: 280 }}>
            {imgSrc && (
              <Cropper
                image={imgSrc}
                crop={crop}
                zoom={zoom}
                minZoom={1}
                maxZoom={5}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>

          {/* Zoom slider */}
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>זום</span>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-primary"
              dir="ltr"
            />
          </div>
        </div>

        <div className="flex flex-row-reverse gap-2 justify-end pt-1">
          <Button type="button" variant="outline" onClick={onCancel} disabled={processing}>
            ביטול
          </Button>
          <Button onClick={handleConfirm} disabled={!croppedAreaPixels || processing}>
            {processing ? "מעבד..." : "אשר"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
