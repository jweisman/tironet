"use client";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineBanner() {
  const { isConnected, hasPendingUploads } = useOnlineStatus();

  if (isConnected) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between bg-amber-500 px-4 py-1.5 text-xs font-medium text-white">
      <span>אין חיבור — עובד במצב לא מקוון</span>
      {hasPendingUploads && (
        <span className="rounded-full bg-white/20 px-2 py-0.5">
          שינויים ממתינים לסנכרון
        </span>
      )}
    </div>
  );
}
