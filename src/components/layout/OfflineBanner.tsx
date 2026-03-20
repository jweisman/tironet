"use client";

import { useState, useEffect } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

// Inner component — only rendered client-side after PowerSync context is available.
function OfflineBannerInner() {
  const { isConnected, hasPendingUploads } = useOnlineStatus();

  if (isConnected) return null;

  return (
    <div role="status" aria-live="polite" className="sticky top-0 z-50 flex items-center justify-between bg-amber-500 px-4 py-1.5 text-xs font-medium text-white">
      <span>אין חיבור — עובד במצב לא מקוון</span>
      {hasPendingUploads && (
        <span className="rounded-full bg-white/20 px-2 py-0.5">
          שינויים ממתינים לסנכרון
        </span>
      )}
    </div>
  );
}

// Outer shell — suppresses SSR render so useStatus() is never called without a context.
export function OfflineBanner() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <OfflineBannerInner />;
}
