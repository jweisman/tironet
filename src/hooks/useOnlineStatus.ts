import { useStatus } from "@powersync/react";
import { useState, useEffect } from "react";

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

  return {
    isConnected: browserOnline && status.connected,
    hasPendingUploads:
      status.dataFlowStatus.uploading === true ||
      status.dataFlowStatus.uploadError !== undefined,
  };
}
