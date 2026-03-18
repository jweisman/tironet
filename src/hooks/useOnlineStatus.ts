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

  // Consider "connected" if the browser is online and PowerSync either hasn't
  // finished its first sync yet (still connecting) or is actively connected.
  // This prevents the offline banner from flashing on page reload while the
  // WebSocket is being established.
  const isConnected = browserOnline && (status.connected || !status.hasSynced);

  return {
    isConnected,
    hasPendingUploads:
      status.dataFlowStatus.uploading === true ||
      status.dataFlowStatus.uploadError !== undefined,
  };
}
