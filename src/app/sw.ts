import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkOnly } from "serwist";
import { defaultCache } from "@serwist/turbopack/worker";

declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Minimal types — WebWorker lib isn't in this tsconfig.
type FetchEvent = Event & {
  readonly request: Request;
  readonly preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
};
type ExtendableEvent = Event & { waitUntil(p: Promise<unknown>): void };

// ---------------------------------------------------------------------------
// Diagnostic logging — visible in Safari Web Inspector → Console for the SW
// ---------------------------------------------------------------------------
const SW_VERSION = "2.0.0";
const LOG_PREFIX = "[SW]";
function swLog(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

swLog("loaded, version", SW_VERSION);

// Log lifecycle events for debugging iOS resume behavior.
(self as unknown as { addEventListener(t: string, h: (e: ExtendableEvent) => void): void }).addEventListener(
  "activate",
  (event) => {
    swLog("activate event, version", SW_VERSION);
    // Clear stale shell caches from previous deployments, then repopulate.
    // Stale cached HTML loads old JS bundles whose RSC state-tree headers
    // don't match the new server, causing 400 errors and reload loops.
    event.waitUntil(clearAndRepopulateShellCaches());
  }
);

// Cache names to clear on activation to prevent stale content after deployment.
const STALE_CACHE_NAMES = [
  // Our shell caches
  "home-html-shell-v1",
  "activities-list-html-shell-v1",
  "soldiers-list-html-shell-v1",
  "activity-html-shell-v1",
  "soldier-html-shell-v1",
  // Serwist defaultCache RSC/page caches (version-specific, stale = 400 errors)
  "pages-rsc-prefetch",
  "pages-rsc",
  "pages",
  "others",
];

async function clearAndRepopulateShellCaches() {
  // 1. Delete all existing shell caches.
  for (const name of STALE_CACHE_NAMES) {
    const deleted = await caches.delete(name);
    if (deleted) swLog("deleted stale cache", name);
  }

  // 2. Repopulate list-page shells from the network.
  const origin = (self as unknown as { location: { origin: string } }).location.origin;
  const routes = ["/home", "/activities", "/soldiers"];
  for (const path of routes) {
    try {
      const res = await fetch(path, { credentials: "same-origin" });
      if (res.ok && !res.redirected) {
        const shell = resolveShellRoute(path, origin);
        if (shell) {
          const cache = await caches.open(shell.htmlCacheName);
          await cache.put(new Request(shell.htmlKey), res);
          swLog("prepopulated shell cache", path);
        }
      } else {
        swLog("prepopulate skipped (not ok or redirected)", path, res.status);
      }
    } catch {
      swLog("prepopulate failed (offline?)", path);
    }
  }
}

// Only precache Next.js static bundles (hashed, no auth needed).
// Page HTML routes, API routes, and PowerSync workers are excluded.
const precacheEntries = (self.__SW_MANIFEST ?? []).filter((entry) => {
  const url = typeof entry === "string" ? entry : entry.url;
  return url.startsWith("/_next/static/");
});

// App shell caching for "use client" pages.
//
// All app pages are client-rendered with data from PowerSync (IndexedDB).
// The server returns the same HTML shell regardless of state, so we can cache
// one copy per route pattern and serve it offline.
//
// This is critical for iOS standalone PWA: when iOS kills and resumes the app,
// it reloads the URL. Without a cached shell, the server-side auth check may
// redirect to /login, creating a loop that iOS shows as "A problem repeatedly
// occurred". Serving the cached shell lets React boot and PowerSync reconnect.
//
// Only navigation (HTML) requests are cached. RSC payloads are NOT cached
// because they are version-specific — serving stale RSC after a deployment
// causes 400 errors that trigger Next.js MPA fallback reloads.
//
// This listener runs BEFORE serwist.addEventListeners() so it calls
// respondWith() first; unmatched requests fall through to Serwist.

// Routes to cache as app shells. Detail routes use a canonical key so any UUID
// shares the same cached shell.
function resolveShellRoute(pathname: string, origin: string): {
  htmlCacheName: string; htmlKey: string;
} | null {
  // List pages (exact path)
  const listRoutes: Record<string, string> = {
    "/home": "home",
    "/activities": "activities-list",
    "/soldiers": "soldiers-list",
  };
  const listMatch = listRoutes[pathname];
  if (listMatch) {
    return {
      htmlCacheName: `${listMatch}-html-shell-v1`,
      htmlKey: `${origin}${pathname}`,
    };
  }

  // Detail pages (UUID-parameterized — cache under a canonical key)
  if (/^\/activities\/[^/]+$/.test(pathname)) {
    return {
      htmlCacheName: "activity-html-shell-v1",
      htmlKey: `${origin}/activities/__html_shell__`,
    };
  }
  if (/^\/soldiers\/[^/]+$/.test(pathname)) {
    return {
      htmlCacheName: "soldier-html-shell-v1",
      htmlKey: `${origin}/soldiers/__html_shell__`,
    };
  }

  return null;
}

(self as unknown as { addEventListener(t: string, h: (e: FetchEvent) => void): void }).addEventListener(
  "fetch",
  (event) => {
    const url = new URL(event.request.url);
    const shell = resolveShellRoute(url.pathname, url.origin);
    if (!shell) return; // Let Serwist handle everything else

    // Only intercept navigation requests (HTML shells). RSC payloads (cors mode)
    // are NOT cached because they are version-specific — serving a stale RSC
    // payload after a deployment causes a 400 from the server, which Next.js
    // recovers from via a full page reload (triggering iOS crash detection).
    if (event.request.mode !== "navigate") return;

    swLog("fetch", url.pathname, "navigate");
    event.respondWith(handleHtmlShell(event, shell.htmlKey, shell.htmlCacheName));
  }
);

// Network-first with cache fallback for HTML shells.
//
// Always fetch from the network to get the latest HTML (which loads the
// correct JS bundles for the current deployment). Fall back to the cached
// shell only when the network fails or returns a redirect (auth redirect
// to /login). The `!response.redirected` check prevents caching login
// pages as shells.
//
// The cache fallback is critical for iOS standalone PWA: when iOS kills and
// resumes the app while offline, the cached shell lets React boot and
// PowerSync reconnect from IndexedDB.
async function handleHtmlShell(
  event: FetchEvent,
  shellKey: string,
  cacheName: string
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const shellReq = new Request(shellKey);

  // 1. Try network first.
  const response = await fetch(event.request).catch(() => undefined);

  if (response?.ok && !response.redirected) {
    swLog("html-shell network OK, caching", shellKey);
    const cloned = response.clone();
    cache.put(shellReq, cloned);
    return response;
  }

  swLog("html-shell network failed/redirected", shellKey, response?.status, response?.redirected);

  // 2. Network failed or returned redirect — serve cached shell.
  const cached = await cache.match(shellReq);
  if (cached) {
    swLog("html-shell CACHE FALLBACK", shellKey);
    return cached;
  }

  // 3. No network, no cache — return the response if we got one (e.g. redirect
  // to /login when session is genuinely expired), otherwise show offline page.
  if (response) return response;

  return offlineFallbackResponse();
}

function offlineFallbackResponse(): Response {
  return new Response(
    `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>אין חיבור</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100dvh; margin: 0; background: #f9fafb; color: #111; }
    .card { text-align: center; padding: 2rem 1.5rem; max-width: 320px; }
    h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { font-size: 0.875rem; color: #6b7280; margin: 0 0 1.5rem; line-height: 1.5; }
    button { display: inline-block; padding: 0.625rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; border: none; cursor: pointer; background: #273617; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>אין חיבור לרשת</h1>
    <p>הדף הזה לא זמין במצב לא מקוון. חזור לרשת ונסה שוב.</p>
    <button onclick="location.reload()">נסה שוב</button>
  </div>
</body>
</html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}


const serwist = new Serwist({
  precacheEntries,
  skipWaiting: true,
  clientsClaim: true,
  // navigationPreload is DISABLED. Safari (pre-18.5) has a critical bug where
  // cached navigation-preload responses with redirects cause the SW to receive
  // a stale/corrupt preload response on subsequent navigations. Since our
  // shell handler does its own fetch(), the preload provides no benefit.
  navigationPreload: false,
  runtimeCaching: [
    // API routes and PowerSync: never cache, always network-only.
    {
      matcher: /\/(api|@powersync)\//,
      handler: new NetworkOnly(),
    },
    // Pages, RSC payloads, and RSC prefetches: always network-only.
    // defaultCache caches these in "pages-rsc-prefetch", "pages-rsc", and
    // "pages" caches. After a deployment, stale RSC from the old deployment
    // confuses the App Router → 400 → MPA fallback reload → iOS crash.
    {
      matcher: ({ request, sameOrigin, url: { pathname } }) =>
        sameOrigin &&
        !pathname.startsWith("/api/") &&
        (request.headers.get("RSC") === "1" ||
          request.headers.get("Next-Router-Prefetch") === "1" ||
          request.mode === "navigate"),
      handler: new NetworkOnly(),
    },
    // Everything else (fonts, images, JS/CSS not in precache):
    // use the default Next.js-aware caching strategies from Serwist.
    ...defaultCache,
  ],
});

serwist.addEventListeners();
