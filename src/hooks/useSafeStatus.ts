"use client";

import { useContext } from "react";
import { useStatus } from "@powersync/react";

// PowerSyncContext is not exported from @powersync/react, but useStatus()
// crashes during SSR when the context is null. This hook returns a safe
// default during SSR so pages can call it unconditionally.
//
// We detect SSR by checking typeof window — on the server, window is undefined
// and PowerSyncContext is guaranteed to be null.

const DEFAULT_STATUS = {
  connected: false,
  hasSynced: false,
  lastSyncedAt: undefined,
  dataFlowStatus: {
    uploading: false,
    downloading: false,
    uploadError: undefined,
  },
} as ReturnType<typeof useStatus>;

export function useSafeStatus(): ReturnType<typeof useStatus> {
  if (typeof window === "undefined") {
    return DEFAULT_STATUS;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStatus();
}
