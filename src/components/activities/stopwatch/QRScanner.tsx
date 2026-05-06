"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface QRScannerProps {
  /** Called once with the decoded QR string when one is detected. */
  onDetect: (raw: string) => void;
  /** Called if the camera can't be opened (permission denied, no camera, etc.). */
  onError?: (message: string) => void;
}

/**
 * Camera-based QR scanner. Uses the native `BarcodeDetector` API where
 * available (Chromium and recent Safari) and falls back to `jsqr` decoding
 * frames captured to a hidden canvas. Tears down camera + animation frame
 * cleanly on unmount.
 *
 * Calls `onDetect` exactly once. The parent is responsible for unmounting
 * (or otherwise stopping) the scanner after a successful read.
 */
export function QRScanner({ onDetect, onError }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    // BarcodeDetector is not yet in lib.dom.d.ts everywhere — keep typing
    // loose and feature-detect at runtime.
    let detector: { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } | null = null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        if (!cancelled) onError?.("לא ניתן לגשת למצלמה");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // playback can fail if user navigates away; treat as cancelled
        return;
      }
      if (cancelled) return;
      setReady(true);

      // Try to use the native BarcodeDetector API.
      const W = window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect: (s: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
        };
      };
      if (W.BarcodeDetector) {
        try {
          detector = new W.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }

      const tick = async () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2) {
          rafId = requestAnimationFrame(() => void tick());
          return;
        }

        let raw: string | null = null;

        if (detector) {
          try {
            const codes = await detector.detect(v);
            if (codes.length > 0) raw = codes[0].rawValue;
          } catch {
            // detection error — try again next frame
          }
        } else {
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx && v.videoWidth > 0) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              try {
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(data.data, data.width, data.height, {
                  inversionAttempts: "dontInvert",
                });
                if (code) raw = code.data;
              } catch {
                // canvas read can fail on some platforms; ignore and continue
              }
            }
          }
        }

        if (raw && !cancelled) {
          onDetect(raw);
          return; // stop after first detection
        }
        rafId = requestAnimationFrame(() => void tick());
      };
      rafId = requestAnimationFrame(() => void tick());
    }

    void start();

    // Capture the current video node at effect setup time so cleanup doesn't
    // read a stale ref (the element may unmount before cleanup runs).
    const videoNode = videoRef.current;

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoNode) videoNode.srcObject = null;
    };
    // onDetect/onError captured by closure — we deliberately mount the
    // scanner once and don't restart the camera if these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full aspect-square overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
          מפעיל מצלמה...
        </div>
      )}
      {/* Viewfinder frame */}
      <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/70" />
    </div>
  );
}
