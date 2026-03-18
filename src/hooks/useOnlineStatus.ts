import { useStatus } from "@powersync/react";
import { useState, useEffect, useRef } from "react";

export function useOnlineStatus() {
  const status = useStatus();

  // navigator.onLine flips immediately when the network drops; PowerSync's
  // WebSocket timeout can take several seconds. Use both so the banner appears
  // instantly even before PowerSync detects the disconnect.
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    const up = () => setBrowserOnline(true);
    const down = () => setBrowserOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // Track whether PowerSync has connected at least once in THIS page session.
  // `status.hasSynced` is persisted across sessions and is always true after
  // the first-ever sync, so it can't distinguish "still booting" from
  // "lost connection". This ref stays false until we see connected: true.
  const hasConnectedRef = useRef(false);
  if (status.connected) hasConnectedRef.current = true;

  // Show offline banner only when:
  // - Browser is offline, OR
  // - PowerSync was connected this session but lost connection
  // Don't show it while PowerSync is still establishing its initial connection.
  const isConnected = browserOnline && (!hasConnectedRef.current || status.connected);

  return {
    isConnected,
    hasPendingUploads:
      status.dataFlowStatus.uploading === true ||
      status.dataFlowStatus.uploadError !== undefined,
  };
}
