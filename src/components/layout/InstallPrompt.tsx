"use client";

import { useState, useEffect } from "react";

const DISMISSED_KEY = "install-prompt-dismissed";

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Detect iOS Safari (the only iOS browser that supports Add to Home Screen).
function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // Exclude Chrome, Firefox, Opera, and Mercury on iOS — they can't install PWAs.
  const isSafari = /safari/i.test(ua) && !/crios|fxios|opios|mercury/i.test(ua);
  return isIOS && isSafari;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function InstallPromptInner() {
  const [androidPrompt, setAndroidPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // Already installed
    if (!isMobile()) return; // Only prompt on mobile devices
    if (localStorage.getItem(DISMISSED_KEY)) return;

    if (isIOSSafari()) {
      setShowIOS(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setAndroidPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setAndroidPrompt(null);
    setShowIOS(false);
  }

  async function installAndroid() {
    if (!androidPrompt) return;
    await androidPrompt.prompt();
    const { outcome } = await androidPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    else setAndroidPrompt(null);
  }

  if (dismissed || (!androidPrompt && !showIOS)) return null;

  return (
    <div className="flex items-start gap-3 border-b border-border bg-muted/60 px-4 py-3 text-sm">
      <div className="flex-1 min-w-0">
        {androidPrompt ? (
          <>
            <p className="font-medium">התקן את האפליקציה</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              הוסף לדף הבית לגישה מהירה ושימוש ללא חיבור
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">התקן את האפליקציה</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              לחץ על{" "}
              <span className="font-medium">שתף</span>
              {" "}←{" "}
              <span className="font-medium">הוסף למסך הבית</span>
              {" "}לגישה מהירה ושימוש ללא חיבור
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {androidPrompt && (
          <button
            onClick={installAndroid}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            התקן
          </button>
        )}
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
          aria-label="סגור"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Suppress SSR render — navigator is not available server-side.
export function InstallPrompt() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <InstallPromptInner />;
}
