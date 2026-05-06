// Diagnostic snapshot captured when useSyncReady decides to render the
// "connection error" state. Read by the support page's collectDiagnostics
// so a user submitting a report from any page automatically includes the
// state of the broken page.
//
// Stored in localStorage so it survives the navigation from the broken
// page to /support. TTL discards stale entries from past sessions.

const STORAGE_KEY = "tironet:last-connection-error";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface ConnectionErrorSnapshot {
  /** ISO timestamp when the error first appeared */
  at: string;
  /** Pathname of the page that hit the error */
  page: string;
  /** Branch of useSyncReady that triggered: "stale-sync" or "first-sync-timeout" */
  trigger: "stale-sync" | "first-sync-timeout";
  /** navigator.onLine at the time */
  online: boolean;
  /** PowerSync hasSynced at the time */
  hasSynced: boolean;
  /** PowerSync dataFlowStatus.downloading at the time */
  downloading: boolean;
  /** Whether the page's primary query had data */
  hasData: boolean;
  /** Optional caller-provided context (selectedCycleId, sessionStatus, etc.) */
  context?: Record<string, unknown>;
}

export function recordConnectionError(snapshot: ConnectionErrorSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage unavailable (private browsing, quota) — silently skip
  }
}

export function readConnectionError(): ConnectionErrorSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as ConnectionErrorSnapshot;
    const ageMs = Date.now() - new Date(snapshot.at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function clearConnectionError(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
