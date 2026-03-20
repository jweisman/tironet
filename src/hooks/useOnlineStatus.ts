import { useStatus } from "@powersync/react";
import { useState, useEffect, useRef } from "react";

const OFFLINE_KEY = "tironet:offline";

function readPersistedOffline(): boolean {
  try {
    return localStorage.getItem(OFFLINE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistOffline(offline: boolean) {
  try {
    if (offline) {
      localStorage.setItem(OFFLINE_KEY, "1");
    } else {
      localStorage.removeItem(OFFLINE_KEY);
    }
  } catch {
    // localStorage unavailable (e.g. private browsing)
  }
}

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
  const hasConnectedRef = useRef(false);
  if (status.connected) hasConnectedRef.current = true;

  // Use persisted offline state so that after an MPA fallback reload the
  // banner appears immediately instead of waiting for the grace period.
  const wasOffline = useRef(readPersistedOffline());

  // Grace period: give PowerSync time to connect after page load.
  // Skip the grace period if we already know we were offline (persisted).
  const [grace, setGrace] = useState(!wasOffline.current);
  useEffect(() => {
    if (!wasOffline.current) {
      const t = setTimeout(() => setGrace(false), 5000);
      return () => clearTimeout(t);
    }
  }, []);

  // Reconnection grace: when the app resumes from background, the WebSocket
  // is dead but navigator.onLine is true. Give PowerSync a few seconds to
  // reconnect before showing the offline banner. If the network is actually
  // down, navigator.onLine flips to false almost immediately, bypassing
  // this grace via the browserOnline check.
  const [reconnectGrace, setReconnectGrace] = useState(false);
  const prevConnectedRef = useRef(status.connected);
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = status.connected;

    if (wasConnected && !status.connected && browserOnline) {
      // WebSocket dropped while browser still has network — likely app resume
      setReconnectGrace(true);
      const t = setTimeout(() => setReconnectGrace(false), 4000);
      return () => clearTimeout(t);
    }
    if (status.connected) {
      // Reconnected — clear any active grace
      setReconnectGrace(false);
    }
  }, [status.connected, browserOnline]);

  const isConnected =
    browserOnline &&
    (status.connected ||
      (!hasConnectedRef.current && grace) ||
      reconnectGrace);

  // Persist offline state for subsequent MPA fallback reloads.
  useEffect(() => {
    persistOffline(!isConnected);
  }, [isConnected]);

  return {
    isConnected,
    hasPendingUploads:
      status.dataFlowStatus.uploading === true ||
      status.dataFlowStatus.uploadError !== undefined,
  };
}
