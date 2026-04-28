"use client";

import { useState, useCallback } from "react";
import { Send, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { clearLocalDatabase } from "@/lib/powersync/clear-local-db";
import { useSyncStatus, type SyncState } from "@/hooks/useSyncStatus";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePowerSync } from "@powersync/react";
import { useSession } from "next-auth/react";
import { useCycle } from "@/contexts/CycleContext";

/** Race a promise against a timeout — returns the result or a timeout marker. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | string> {
  return Promise.race([
    promise,
    new Promise<string>((resolve) => setTimeout(() => resolve(`TIMEOUT after ${ms}ms (${label})`), ms)),
  ]);
}

/** Safe db.execute that won't hang if init() hasn't completed. */
async function safeExecute(db: ReturnType<typeof usePowerSync>, sql: string, params?: unknown[]) {
  const result = await withTimeout(db.execute(sql, params), 5_000, sql.slice(0, 60));
  if (typeof result === "string") throw new Error(result);
  return result;
}

async function collectDiagnostics(
  db: ReturnType<typeof usePowerSync>,
  session: ReturnType<typeof useSession>["data"],
  sessionStatus: string,
  selectedCycleId: string | null,
  selectedAssignment: { role: string; unitId: string; unitType: string } | null,
  cycleIsLoading: boolean,
) {
  const diagnostics: Record<string, unknown> = {};

  // Device & browser
  diagnostics["Device"] = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenSize: `${screen.width}×${screen.height}`,
    viewportSize: `${window.innerWidth}×${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    standalone: window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone),
    online: navigator.onLine,
    cookiesEnabled: navigator.cookieEnabled,
  };

  // Storage
  try {
    const estimate = await navigator.storage.estimate();
    diagnostics["Storage"] = {
      usageKB: Math.round((estimate.usage ?? 0) / 1024),
      quotaKB: Math.round((estimate.quota ?? 0) / 1024),
      persisted: await navigator.storage.persisted?.() ?? "N/A",
    };
  } catch {
    diagnostics["Storage"] = { error: "navigator.storage unavailable" };
  }

  // Session & assignment
  diagnostics["Session"] = {
    userId: session?.user?.id ?? "not logged in",
    email: session?.user?.email ?? "—",
    isAdmin: session?.user?.isAdmin ?? false,
    sessionStatus,
    cycleIsLoading,
    selectedCycleId: selectedCycleId ?? "none",
    role: selectedAssignment?.role ?? "none",
    unitType: selectedAssignment?.unitType ?? "—",
    unitId: selectedAssignment?.unitId ?? "—",
  };

  // PowerSync status
  try {
    const status = db.currentStatus;
    const serializeError = (err: unknown) => {
      if (!err) return false;
      if (err instanceof Error) return { name: err.name, message: err.message };
      return JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    };
    diagnostics["PowerSync"] = {
      dbReady: (db as unknown as { ready?: boolean }).ready ?? "unknown",
      connected: status?.connected ?? false,
      hasSynced: status?.hasSynced ?? false,
      lastSyncedAt: status?.lastSyncedAt?.toISOString() ?? "never",
      downloading: String(status?.dataFlowStatus?.downloading ?? "unknown"),
      uploading: String(status?.dataFlowStatus?.uploading ?? "unknown"),
      downloadError: serializeError(status?.dataFlowStatus?.downloadError),
      uploadError: serializeError(status?.dataFlowStatus?.uploadError),
    };
  } catch (e) {
    diagnostics["PowerSync"] = { error: String(e) };
  }

  // If init() hasn't completed, all db.execute() calls will hang on waitForReady().
  // Skip DB queries entirely — the PowerSync section above already captured db.ready.
  const dbReady = (db as unknown as { ready?: boolean }).ready ?? false;
  if (!dbReady) {
    diagnostics["Table Row Counts"] = "skipped (db not ready)";
    diagnostics["Sync Buckets"] = "skipped (db not ready)";
    diagnostics["Oplog Summary"] = "skipped (db not ready)";
    diagnostics["Sample Queries"] = "skipped (db not ready)";
    // Skip to non-DB sections below
  }

  // Table row counts
  if (dbReady) try {
    const tables = ["soldiers", "squads", "platoons", "companies", "cycles", "activity_types", "activities", "activity_reports", "requests", "request_actions"];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const result = await safeExecute(db, `SELECT COUNT(*) as c FROM ${table}`);
        counts[table] = Number(result.rows?._array?.[0]?.c ?? result.rows?.item?.(0)?.c ?? 0);
      } catch {
        counts[table] = -1; // table doesn't exist or query failed
      }
    }
    diagnostics["Table Row Counts"] = counts;
  } catch (e) {
    diagnostics["Table Row Counts"] = { error: String(e) };
  }

  // PowerSync buckets
  if (dbReady) try {
    const buckets = await safeExecute(db, "SELECT name, count_at_last, count_since_last FROM ps_buckets LIMIT 20");
    const rows = buckets.rows?._array ?? [];
    diagnostics["Sync Buckets"] = rows.length > 0
      ? rows.map((r: Record<string, unknown>) => ({
          name: r.name,
          countAtLast: r.count_at_last,
          countSinceLast: r.count_since_last,
        }))
      : "no buckets";
  } catch (e) {
    diagnostics["Sync Buckets"] = { error: String(e) };
  }

  // PowerSync sync claims from token
  try {
    const controller = new AbortController();
    const tokenTimeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch("/api/powersync/token", { signal: controller.signal });
    clearTimeout(tokenTimeout);
    if (res.ok) {
      const { token } = await res.json();
      // Decode JWT payload (base64url)
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      diagnostics["Sync Claims"] = {
        cycle_ids: payload.cycle_ids,
        squad_ids: payload.squad_ids,
        platoon_ids: payload.platoon_ids,
        company_ids: payload.company_ids,
        exp: new Date(payload.exp * 1000).toISOString(),
      };
    }
  } catch (e) {
    diagnostics["Sync Claims"] = { error: String(e) };
  }

  // ps_oplog sample — check if rows arrived but were processed as REMOVEs
  if (dbReady) try {
    const oplogCount = await safeExecute(db, "SELECT COUNT(*) as cnt FROM ps_oplog");
    const total = Number(oplogCount.rows?._array?.[0]?.cnt ?? 0);
    if (total > 0) {
      // Try to get a sample of recent ops
      const sample = await safeExecute(db, "SELECT * FROM ps_oplog LIMIT 5");
      const sampleRows = sample.rows?._array ?? [];
      diagnostics["Oplog Summary"] = {
        totalOps: total,
        sampleColumns: sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [],
        sample: sampleRows.map((r: Record<string, unknown>) => {
          const { data, ...rest } = r;
          return JSON.stringify({ ...rest, data: typeof data === "string" ? `${data.slice(0, 80)}…` : data });
        }),
      };
    } else {
      diagnostics["Oplog Summary"] = "empty (0 ops)";
    }
  } catch (e) {
    diagnostics["Oplog Summary"] = { error: String(e) };
  }

  // Sample queries — run the same queries the home/soldiers pages use
  if (dbReady) try {
    const cycleId = selectedCycleId ?? "";
    const squads = await safeExecute(db,
      `SELECT sq.id, sq.name, p.name AS platoon_name FROM squads sq JOIN platoons p ON p.id = sq.platoon_id WHERE sq.platoon_id IN (SELECT id FROM platoons WHERE id IN (SELECT platoon_id FROM squads WHERE id IN (SELECT squad_id FROM soldiers WHERE cycle_id = ?))) LIMIT 10`,
      [cycleId]
    );
    const soldiers = await safeExecute(db,
      "SELECT COUNT(*) as cnt FROM soldiers WHERE cycle_id = ?",
      [cycleId]
    );
    const allSquads = await safeExecute(db, "SELECT COUNT(*) as cnt FROM squads");
    const allPlatoons = await safeExecute(db, "SELECT COUNT(*) as cnt FROM platoons");
    // Show what cycle_ids soldiers actually have — helps diagnose stale data
    const soldierCycles = await safeExecute(db,
      "SELECT cycle_id, COUNT(*) as cnt FROM soldiers GROUP BY cycle_id LIMIT 10"
    );

    diagnostics["Sample Queries"] = {
      selectedCycleId: cycleId || "none",
      squadsForCycle: squads.rows?._array?.map((r: Record<string, unknown>) => `${r.platoon_name} > ${r.name}`) ?? [],
      soldiersForCycle: Number(soldiers.rows?._array?.[0]?.cnt ?? 0),
      soldiersByCycleId: soldierCycles.rows?._array?.map((r: Record<string, unknown>) => `${r.cycle_id}: ${r.cnt}`) ?? [],
      totalSquads: Number(allSquads.rows?._array?.[0]?.cnt ?? 0),
      totalPlatoons: Number(allPlatoons.rows?._array?.[0]?.cnt ?? 0),
    };
  } catch (e) {
    diagnostics["Sample Queries"] = { error: String(e) };
  }

  // Service worker
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const controller = navigator.serviceWorker?.controller;
    diagnostics["Service Worker"] = {
      registered: !!reg,
      active: !!reg?.active,
      scope: reg?.scope ?? "—",
      updateFound: !!reg?.installing || !!reg?.waiting,
      waiting: !!reg?.waiting,
      controllerState: controller?.state ?? "no controller",
      controllerScriptURL: controller?.scriptURL
        ? new URL(controller.scriptURL).pathname
        : "none",
    };
  } catch {
    diagnostics["Service Worker"] = { registered: false };
  }

  // PWA / splash screen diagnostics
  try {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const splashLinks = Array.from(document.querySelectorAll('link[rel="apple-touch-startup-image"]'));
    const matchingSplash = splashLinks.filter((link) => {
      const media = link.getAttribute("media");
      return media ? window.matchMedia(media).matches : false;
    });

    // Test if the matching splash image actually loads
    let splashImageTest: string = "no matching link";
    if (matchingSplash.length > 0) {
      const href = matchingSplash[0].getAttribute("href");
      if (href) {
        try {
          const start = performance.now();
          const imgRes = await fetch(href, { cache: "no-store" });
          const elapsed = Math.round(performance.now() - start);
          if (imgRes.ok) {
            const contentType = imgRes.headers.get("content-type");
            const contentLength = imgRes.headers.get("content-length");
            splashImageTest = `OK ${imgRes.status} (${contentType}, ${contentLength ? Math.round(Number(contentLength) / 1024) + "KB" : "unknown size"}, ${elapsed}ms)`;
          } else {
            splashImageTest = `FAILED ${imgRes.status} ${imgRes.statusText}`;
          }
        } catch (fetchErr) {
          splashImageTest = `FETCH ERROR: ${String(fetchErr)}`;
        }
      }
    }

    diagnostics["PWA"] = {
      isIOS,
      standalone: window.matchMedia("(display-mode: standalone)").matches
        || ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone),
      splashLinksTotal: splashLinks.length,
      matchingSplashMedia: matchingSplash.length > 0
        ? matchingSplash.map((l) => l.getAttribute("media"))
        : `none matching (device: ${screen.width}×${screen.height} @${window.devicePixelRatio}x)`,
      matchingSplashHref: matchingSplash[0]?.getAttribute("href") ?? "none",
      splashImageTest,
    };
  } catch (e) {
    diagnostics["PWA"] = { error: String(e) };
  }

  // Shell cache status — check if the current page's shell exists in the SW cache
  try {
    const shellCaches = await caches.keys();
    const shellCacheNames = shellCaches.filter((n) => n.startsWith("app-shells-"));
    const shellInfo: Record<string, unknown> = {
      shellCaches: shellCacheNames,
    };
    if (shellCacheNames.length > 0) {
      const cache = await caches.open(shellCacheNames[0]);
      const keys = await cache.keys();
      shellInfo.cachedShells = keys.map((r) => new URL(r.url).pathname);
    }
    diagnostics["Shell Cache"] = shellInfo;
  } catch (e) {
    diagnostics["Shell Cache"] = { error: String(e) };
  }

  // Startup timeline — performance marks set by layout.tsx and AppShell
  try {
    const marks = [
      "theme-init", "appshell-mount", "splash-dismissed",
      "powersync-init-start", "powersync-init-end",
      "powersync-connect-start", "powersync-connect-end",
    ];
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const timeline: Record<string, string> = {};
    if (nav) {
      timeline["navigationStart"] = "0ms";
      timeline["navigationType"] = nav.type; // navigate, reload, back_forward, prerender
      timeline["domContentLoaded"] = `${Math.round(nav.domContentLoadedEventStart)}ms`;
      timeline["loadEvent"] = `${Math.round(nav.loadEventStart)}ms`;
    }
    for (const name of marks) {
      const entries = performance.getEntriesByName(name, "mark");
      if (entries.length > 0) {
        timeline[name] = `${Math.round(entries[0].startTime)}ms`;
      } else {
        timeline[name] = "not recorded";
      }
    }
    diagnostics["Startup Timeline"] = timeline;
  } catch (e) {
    diagnostics["Startup Timeline"] = { error: String(e) };
  }

  // Entry point — how was the app opened?
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    diagnostics["Entry Point"] = {
      currentUrl: window.location.href,
      referrer: document.referrer || "none",
      navigationType: nav?.type ?? "unknown",
      startUrl: sessionStorage.getItem("tironet:entry-url") ?? "not captured",
    };
  } catch (e) {
    diagnostics["Entry Point"] = { error: String(e) };
  }

  // Boot-time state — captured by inline script in layout.tsx at earliest paint
  try {
    const bootRaw = sessionStorage.getItem("tironet:boot");
    if (bootRaw) {
      const boot = JSON.parse(bootRaw);
      diagnostics["Boot State"] = {
        themePref: boot.theme,
        darkModeApplied: boot.dark,
        screenAtBoot: `${boot.w}×${boot.h} @${boot.dpr}x`,
        bootTimestamp: new Date(boot.t).toISOString(),
      };
    } else {
      diagnostics["Boot State"] = "not captured (sessionStorage empty)";
    }
  } catch (e) {
    diagnostics["Boot State"] = { error: String(e) };
  }

  // Computed styles — what colors are actually rendered right now
  try {
    const bodyStyles = getComputedStyle(document.body);
    const htmlStyles = getComputedStyle(document.documentElement);
    const splashEl = document.getElementById("app-splash");
    diagnostics["Computed Styles"] = {
      htmlBackground: htmlStyles.backgroundColor,
      bodyBackground: bodyStyles.backgroundColor,
      bodyColor: bodyStyles.color,
      darkClassPresent: document.documentElement.classList.contains("dark"),
      splashDisplay: splashEl?.style.display ?? "element not found",
      splashComputedBg: splashEl ? getComputedStyle(splashEl).backgroundColor : "element not found",
    };
  } catch (e) {
    diagnostics["Computed Styles"] = { error: String(e) };
  }

  return diagnostics;
}

export default function SupportPage() {
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const db = usePowerSync();
  const { data: session, status: sessionStatus } = useSession();
  const { selectedCycleId, selectedAssignment, isLoading: cycleIsLoading } = useCycle();

  async function handleSubmit() {
    setSending(true);
    try {
      const diagnostics = await collectDiagnostics(db, session, sessionStatus, selectedCycleId ?? null, selectedAssignment ?? null, cycleIsLoading);

      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() || undefined, diagnostics }),
      });

      if (!res.ok) throw new Error("Failed to send");
      setSent(true);
      toast.success("הדיווח נשלח בהצלחה");
    } catch {
      toast.error("שגיאה בשליחת הדיווח. נסה שוב.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4 px-4">
        <CheckCircle size={48} className="text-emerald-600" />
        <h1 className="text-xl font-bold">הדיווח נשלח</h1>
        <p className="text-muted-foreground text-sm max-w-md">
          קיבלנו את הדיווח שלך עם כל פרטי האבחון. נחזור אליך בהקדם.
        </p>
        <Button variant="outline" onClick={() => { setSent(false); setDescription(""); }}>
          שלח דיווח נוסף
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 py-4">
      <div>
        <h1 className="text-xl font-bold">תמיכה</h1>
        <p className="text-sm text-muted-foreground mt-1">
          תאר את הבעיה ושלח — אנחנו נקבל את כל פרטי האבחון הנדרשים לטיפול.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="support-desc" className="text-sm font-medium">
          תיאור הבעיה (אופציונלי)
        </label>
        <textarea
          id="support-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="מה קרה? מה ציפית שיקרה?"
          rows={4}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={sending}
        className="w-full"
      >
        {sending ? (
          <>
            <Loader2 size={16} className="animate-spin me-2" />
            שולח דיווח...
          </>
        ) : (
          <>
            <Send size={16} className="me-2" />
            שלח דיווח
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        הדיווח כולל מידע טכני על המכשיר, הדפדפן, ומצב הסנכרון — ללא מידע אישי על חיילים.
      </p>

      <SyncStatusSection />
    </div>
  );
}

const STATE_LABELS: Record<SyncState, { label: string; color: string }> = {
  synced: { label: "מסונכרן", color: "text-emerald-600" },
  syncing: { label: "מסנכרן...", color: "text-blue-600" },
  stale: { label: "לא מחובר", color: "text-amber-600" },
  error: { label: "שגיאה", color: "text-red-600" },
  initializing: { label: "מאתחל...", color: "text-muted-foreground" },
};

function SyncStatusSection() {
  const { state, lastSyncedAt } = useSyncStatus();
  const { label, color } = STATE_LABELS[state];
  const isError = state === "error";

  const [clearing, setClearing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetExpanded, setResetExpanded] = useState(false);

  const handleClear = useCallback(async () => {
    setClearing(true);
    await clearLocalDatabase();
  }, []);

  const lastSyncLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })
    : "לא סונכרן";

  return (
    <div className="border-t pt-6 mt-6 space-y-3">
      <h2 className="text-sm font-medium">מצב סנכרון</h2>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">סטטוס</span>
          <span className={`text-xs font-medium ${color}`}>{label}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">סנכרון אחרון</span>
          <span className="text-xs">{lastSyncLabel}</span>
        </div>
      </div>

      {/* Reset option — expanded by default on error, collapsible otherwise */}
      {isError && !resetExpanded && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <p className="text-xs text-red-700 dark:text-red-400">
            אותרה שגיאה בנתונים המקומיים. מומלץ לאפס ולסנכרן מחדש.
          </p>
          {!confirmOpen ? (
            <Button
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              className="w-full"
              size="sm"
            >
              <RefreshCw size={14} className="me-2" />
              איפוס וסנכרון מחדש
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-600 font-medium">
                האפליקציה תיטען מחדש והנתונים יסונכרנו מהשרת. להמשיך?
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" onClick={handleClear} disabled={clearing} className="flex-1" size="sm">
                  {clearing ? <><Loader2 size={14} className="animate-spin me-2" />מאפס...</> : "אישור"}
                </Button>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={clearing} className="flex-1" size="sm">
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isError && (
        <>
          {!resetExpanded ? (
            <button
              type="button"
              onClick={() => setResetExpanded(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              איפוס נתונים מקומיים...
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                אם הנתונים לא מתעדכנים או שיש תקלות חוזרות, ניתן לאפס את הנתונים המקומיים ולסנכרן מחדש. פעולה זו לא מוחקת נתונים מהשרת.
              </p>
              {!confirmOpen ? (
                <Button
                  variant="outline"
                  onClick={() => setConfirmOpen(true)}
                  className="w-full"
                  size="sm"
                >
                  <RefreshCw size={14} className="me-2" />
                  איפוס וסנכרון מחדש
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-amber-600 font-medium">
                    האפליקציה תיטען מחדש והנתונים יסונכרנו מהשרת. להמשיך?
                  </p>
                  <div className="flex gap-2">
                    <Button variant="destructive" onClick={handleClear} disabled={clearing} className="flex-1" size="sm">
                      {clearing ? <><Loader2 size={14} className="animate-spin me-2" />מאפס...</> : "אישור"}
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={clearing} className="flex-1" size="sm">
                      ביטול
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
