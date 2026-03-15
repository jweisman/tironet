import { useStatus } from "@powersync/react";

export function useOnlineStatus() {
  const status = useStatus();
  return {
    isConnected: status.connected,
    hasPendingUploads:
      status.dataFlowStatus.uploading === true ||
      status.dataFlowStatus.uploadError !== undefined,
  };
}
