"use client";

import { useState, useCallback } from "react";
import { Send, CheckCircle, Loader2, RefreshCw, Bell } from "lucide-react";
import { clearLocalDatabase } from "@/lib/powersync/clear-local-db";
import { readPagePerf } from "@/hooks/usePagePerf";
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

  // Performance probe — verifies index migration ran, captures query plans, times each hot query.
  // Queries here mirror the ones in soldiers/activities/requests list pages — keep in sync.
  if (dbReady && (selectedCycleId ?? "")) try {
    const cycleId = selectedCycleId ?? "";
    const probe: Record<string, unknown> = {};

    // 1. List user-defined indexes. PowerSync stores synced rows in ps_data__<view> tables
    // and exposes the friendly name as a SQLite view, so our indexes attach to ps_data__*.
    // Filter by sql IS NOT NULL to skip implicit primary-key indexes.
    try {
      const idxResult = await safeExecute(
        db,
        `SELECT tbl_name, name FROM sqlite_master
         WHERE type='index' AND sql IS NOT NULL
         ORDER BY tbl_name, name`,
      );
      const idxRows = idxResult.rows?._array ?? [];
      probe.indexCount = idxRows.length;
      probe.indexes = idxRows
        .map((r: Record<string, unknown>) => {
          const tbl = String(r.tbl_name ?? "").replace(/^ps_data__/, "");
          return `${tbl}.${r.name}`;
        })
        .join(", ") || "(none)";
    } catch (e) {
      probe.indexes = `error: ${String(e)}`;
    }

    // 2. Hot queries to benchmark + EXPLAIN QUERY PLAN
    const HOT: { label: string; sql: string; params: unknown[] }[] = [
      {
        label: "soldiers/SOLDIERS",
        sql: `SELECT s.id, s.given_name, s.family_name, s.id_number, s.civilian_id, s.rank, s.status, s.profile_image, s.phone, s.squad_id FROM soldiers s WHERE s.cycle_id = ? ORDER BY s.family_name ASC, s.given_name ASC`,
        params: [cycleId],
      },
      {
        label: "soldiers/GAP_COUNT",
        sql: `SELECT s.id AS soldier_id, COUNT(DISTINCT a.id) AS gap_count FROM soldiers s JOIN squads sq ON sq.id = s.squad_id JOIN activities a ON a.platoon_id = sq.platoon_id AND a.cycle_id = s.cycle_id AND a.is_required = 1 AND a.status = 'active' AND a.date < DATE('now') LEFT JOIN activity_reports ar ON ar.activity_id = a.id AND ar.soldier_id = s.id WHERE s.cycle_id = ? AND (ar.id IS NULL OR ar.result = 'skipped' OR ar.failed = 1) GROUP BY s.id`,
        params: [cycleId],
      },
      {
        label: "soldiers/OPEN_REQUESTS",
        sql: `SELECT r.soldier_id, r.type, r.status, r.urgent, r.special_conditions FROM requests r WHERE r.cycle_id = ? AND ((r.status = 'approved' AND ((r.type = 'leave' AND (r.departure_at >= DATE('now') OR r.return_at >= DATE('now'))) OR (r.type = 'medical' AND ((r.medical_appointments IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(r.medical_appointments) AS a WHERE json_extract(a.value, '$.date') >= DATE('now'))) OR (r.sick_days IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(r.sick_days) AS d WHERE json_extract(d.value, '$.date') >= DATE('now'))))))) OR r.status = 'open')`,
        params: [cycleId],
      },
      {
        label: "activities/ACTIVITIES",
        sql: `SELECT a.id, a.name, a.date, a.status, a.is_required, at.name AS activity_type_name, at.icon AS activity_type_icon, p.id AS platoon_id, p.name AS platoon_name, c.name AS company_name FROM activities a JOIN activity_types at ON at.id = a.activity_type_id JOIN platoons p ON p.id = a.platoon_id JOIN companies c ON c.id = p.company_id WHERE a.cycle_id = ? ORDER BY a.date DESC`,
        params: [cycleId],
      },
      {
        label: "activities/REPORT_COUNTS",
        sql: `SELECT ar.activity_id, COUNT(*) AS reported_count, SUM(CASE WHEN ar.result = 'completed' AND ar.failed = 0 THEN 1 ELSE 0 END) AS completed_count, SUM(CASE WHEN ar.result = 'skipped' THEN 1 ELSE 0 END) AS skipped_count, SUM(CASE WHEN ar.failed = 1 THEN 1 ELSE 0 END) AS score_failed_count, SUM(CASE WHEN ar.result = 'na' THEN 1 ELSE 0 END) AS na_count FROM activity_reports ar JOIN activities a ON a.id = ar.activity_id JOIN soldiers s ON s.id = ar.soldier_id WHERE a.cycle_id = ? AND (? = '' OR s.squad_id = ?) GROUP BY ar.activity_id`,
        params: [cycleId, "", ""],
      },
      {
        label: "activities/SOLDIER_COUNTS",
        sql: `SELECT sq.platoon_id, COUNT(*) AS total_soldiers FROM soldiers s JOIN squads sq ON sq.id = s.squad_id WHERE s.status = 'active' AND s.cycle_id = ? AND (? = '' OR s.squad_id = ?) GROUP BY sq.platoon_id`,
        params: [cycleId, "", ""],
      },
      {
        label: "requests/REQUESTS",
        sql: `SELECT r.id, r.type, r.status, r.assigned_role, r.description, r.urgent, r.special_conditions, r.created_at, r.departure_at, r.return_at, r.medical_appointments, r.sick_days, s.family_name || ' ' || s.given_name AS soldier_name, s.squad_id, sq.name AS squad_name, sq.platoon_id, p.name AS platoon_name FROM requests r JOIN soldiers s ON s.id = r.soldier_id JOIN squads sq ON sq.id = s.squad_id JOIN platoons p ON p.id = sq.platoon_id WHERE r.cycle_id = ? ORDER BY r.created_at DESC`,
        params: [cycleId],
      },
    ];

    // Each query gets two flat keys: `<label>` (timing summary) and `<label>.plan` (query plan).
    // Flat values are required because the email renderer only expands one level of nesting.
    for (const { label, sql, params } of HOT) {
      try {
        const plan = await safeExecute(db, `EXPLAIN QUERY PLAN ${sql}`, params);
        const planRows = plan.rows?._array ?? [];
        const planText = planRows
          .map((r: Record<string, unknown>) => String(r.detail ?? ""))
          .filter(Boolean)
          .join(" | ");

        const times: number[] = [];
        let rowCount = 0;
        for (let i = 0; i < 3; i++) {
          const start = performance.now();
          const res = await safeExecute(db, sql, params);
          const elapsed = performance.now() - start;
          times.push(Math.round(elapsed));
          if (i === 0) rowCount = res.rows?._array?.length ?? 0;
        }

        probe[label] = `rows=${rowCount} times=${times.join("/")}ms`;
        probe[`${label}.plan`] = planText.length > 600 ? `${planText.slice(0, 600)}…` : planText;
      } catch (e) {
        probe[label] = `error: ${String(e)}`;
      }
    }

    diagnostics["Performance Probe"] = probe;
  } catch (e) {
    diagnostics["Performance Probe"] = { error: String(e) };
  }

  // Push Notifications — browser-side state
  try {
    const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const pushDiag: Record<string, unknown> = {
      supported: pushSupported,
      permission: pushSupported ? Notification.permission : "unsupported",
    };

    if (pushSupported) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches
        || ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone);
      pushDiag.iosRequiresInstall = isIOS && !isStandalone;

      // Check for active PushManager subscription
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          pushDiag.hasActiveSubscription = !!sub;
          if (sub) {
            pushDiag.subscriptionEndpointDomain = new URL(sub.endpoint).hostname;
            pushDiag.subscriptionEndpointSuffix = sub.endpoint.slice(-16);
            pushDiag.subscriptionExpirationTime = sub.expirationTime
              ? new Date(sub.expirationTime).toISOString()
              : null;
          }
        } else {
          pushDiag.hasActiveSubscription = false;
          pushDiag.noServiceWorkerRegistration = true;
        }
      } catch (e) {
        pushDiag.subscriptionCheckError = String(e);
      }
    }

    // Server-side subscription and preference data
    try {
      const controller = new AbortController();
      const pushTimeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch("/api/push/diagnostics", { signal: controller.signal });
      clearTimeout(pushTimeout);
      if (res.ok) {
        const serverData = await res.json();
        pushDiag.serverSubscriptionCount = serverData.subscriptions?.length ?? 0;
        // Flatten subscriptions to readable strings (avoid [object Object])
        if (serverData.subscriptions?.length > 0) {
          serverData.subscriptions.forEach((s: { endpointDomain: string; endpointSuffix: string; createdAt: string }, i: number) => {
            const matchTag = pushDiag.subscriptionEndpointSuffix === s.endpointSuffix ? " [MATCH]" : "";
            pushDiag[`serverSub${i + 1}`] = `…${s.endpointSuffix} (${new Date(s.createdAt).toLocaleDateString("he-IL")})${matchTag}`;
          });
        }
        // Flatten preferences into individual keys
        if (serverData.preferences) {
          const p = serverData.preferences;
          pushDiag.prefDailyTasks = p.dailyTasksEnabled;
          pushDiag.prefRequestAssignment = p.requestAssignmentEnabled;
          pushDiag.prefActiveRequests = p.activeRequestsEnabled;
          pushDiag.prefNewAppointment = p.newAppointmentEnabled;
          pushDiag.prefReminderMinutes = p.reminderLeadMinutes ?? "disabled";
        } else {
          pushDiag.serverPreferences = "none (no preference row)";
        }

        // Flag mismatch: compare actual endpoints, not just domains
        if (pushDiag.hasActiveSubscription && serverData.subscriptions?.length === 0) {
          pushDiag.mismatch = "browser has subscription but server has none — resubscribe";
        } else if (!pushDiag.hasActiveSubscription && serverData.subscriptions?.length > 0) {
          pushDiag.mismatch = "server has subscriptions but browser has none — stale server records";
        } else if (
          pushDiag.hasActiveSubscription &&
          pushDiag.subscriptionEndpointSuffix &&
          serverData.subscriptions?.length > 0 &&
          !serverData.subscriptions.some(
            (s: { endpointSuffix: string }) => s.endpointSuffix === pushDiag.subscriptionEndpointSuffix,
          )
        ) {
          pushDiag.mismatch = "browser endpoint not found on server — notifications go to stale endpoints";
        }
      } else {
        pushDiag.serverFetchError = `HTTP ${res.status}`;
      }
    } catch (e) {
      pushDiag.serverFetchError = String(e);
    }

    diagnostics["Push Notifications"] = pushDiag;
  } catch (e) {
    diagnostics["Push Notifications"] = { error: String(e) };
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

  // Page render timing — most-recent visit to each list page
  // (recorded by usePagePerf hook, written to sessionStorage on each mount/data-ready)
  try {
    const pageTimings: Record<string, string> = {};
    for (const pageId of ["soldiers", "activities", "requests"]) {
      const entry = readPagePerf(pageId);
      if (!entry) {
        pageTimings[pageId] = "not visited this session";
        continue;
      }
      const ago = Math.round((Date.now() - entry.loggedAt) / 1000);
      const ready = entry.mountToReadyMs == null
        ? "data not ready"
        : `${entry.mountToReadyMs}ms mount→data`;
      pageTimings[pageId] = `${ready} (${ago}s ago)`;
    }
    diagnostics["Page Render Timing"] = pageTimings;
  } catch (e) {
    diagnostics["Page Render Timing"] = { error: String(e) };
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

      <TestNotificationSection />
      <SyncStatusSection />
    </div>
  );
}

function TestNotificationSection() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult({ success: false, message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      if (data.subscriptionsFound === 0) {
        setResult({ success: false, message: "לא נמצאו מנויים — יש להפעיל התראות בעמוד הפרופיל" });
      } else if (data.sent > 0) {
        setResult({ success: true, message: `נשלח בהצלחה ל-${data.sent} מכשירים${data.staleRemoved > 0 ? ` (${data.staleRemoved} מנויים ישנים הוסרו)` : ""}` });
      } else if (data.staleRemoved > 0) {
        setResult({ success: false, message: `כל ${data.staleRemoved} המנויים היו לא תקינים והוסרו — יש לכבות ולהדליק מחדש התראות בפרופיל` });
      } else {
        setResult({ success: false, message: `שליחה נכשלה (${data.failed} שגיאות)` });
      }
    } catch {
      setResult({ success: false, message: "שגיאת רשת — נסה שוב" });
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <div className="border-t pt-6 mt-6 space-y-3">
      <h2 className="text-sm font-medium">בדיקת התראות</h2>
      <p className="text-xs text-muted-foreground">
        שלח הודעת בדיקה למכשיר זה כדי לוודא שהתראות מגיעות.
      </p>
      <Button
        variant="outline"
        onClick={handleTest}
        disabled={testing}
        className="w-full"
        size="sm"
      >
        {testing ? (
          <>
            <Loader2 size={14} className="animate-spin me-2" />
            שולח...
          </>
        ) : (
          <>
            <Bell size={14} className="me-2" />
            שלח הודעת בדיקה
          </>
        )}
      </Button>
      {result && (
        <p className={`text-xs ${result.success ? "text-emerald-600" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
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
  const { state, lastSyncedAt, errorMessage } = useSyncStatus();
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
    : state === "initializing" ? "מהסנכרון הקודם" : "לא סונכרן";

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
        {errorMessage && (
          <div className="pt-1 border-t border-border">
            <span className="text-xs text-muted-foreground">שגיאה</span>
            <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all mt-0.5">{errorMessage}</p>
          </div>
        )}
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
