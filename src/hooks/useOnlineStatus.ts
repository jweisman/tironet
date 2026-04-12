import { useStatus } from "@powersync/react";
import { useState, useEffect, useRef } from "react";

export function useOnlineStatus() {
  const status = useStatus();

  // The offline banner reflects device connectivity (navigator.onLine),
  // not PowerSync sync status. If we're online but PowerSync can't connect
  // (captive portal, server outage), data is still read/written locally
  // and resyncs automatically when the issue resolves.
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

  // Debounce online → offline transitions by 2 seconds so brief network
  // blips don't flash the offline banner. Offline → online is instant.
  const [isConnected, setIsConnected] = useState(browserOnline);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (browserOnline) {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      setIsConnected(true);
    } else {
      if (!offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          offlineTimerRef.current = null;
          setIsConnected(false);
        }, 2000);
      }
    }
    return () => {
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, [browserOnline]);

  return {
    isConnected,
    hasPendingUploads:
      status.dataFlowStatus.uploading === true ||
      status.dataFlowStatus.uploadError !== undefined,
  };
}
