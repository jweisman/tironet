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
    // Pre-populate shell caches on first activation so that iOS resume
    // always has a cache to fall back to (iOS can evict Cache Storage).
    event.waitUntil(prepopulateShellCaches());
  }
);

// Fetch each shell route once to prime the cache. Errors are swallowed —
// the user will populate caches naturally by navigating.
async function prepopulateShellCaches() {
  const routes = ["/home", "/activities", "/soldiers"];
  for (const path of routes) {
    try {
      const res = await fetch(path, { credentials: "same-origin" });
      if (res.ok && !res.redirected) {
        const shell = resolveShellRoute(path, (self as unknown as { location: { origin: string } }).location.origin);
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
// Two caches per route pattern:
//   <name>-html  — the navigation HTML shell (hard refresh / direct URL)
//   <name>-rsc   — the RSC payload (client-side navigation via Next.js router)
//
// This listener runs BEFORE serwist.addEventListeners() so it calls
// respondWith() first; unmatched requests fall through to Serwist.

// Routes to cache as app shells. Detail routes use a canonical key so any UUID
// shares the same cached shell.
function resolveShellRoute(pathname: string, origin: string): {
  htmlCacheName: string; htmlKey: string;
  rscCacheName: string; rscKey: string;
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
      rscCacheName: `${listMatch}-rsc-shell-v1`,
      rscKey: `${origin}${pathname}/__rsc_shell__`,
    };
  }

  // Detail pages (UUID-parameterized — cache under a canonical key)
  if (/^\/activities\/[^/]+$/.test(pathname)) {
    return {
      htmlCacheName: "activity-html-shell-v1",
      htmlKey: `${origin}/activities/__html_shell__`,
      rscCacheName: "activity-rsc-shell-v1",
      rscKey: `${origin}/activities/__rsc_shell__`,
    };
  }
  if (/^\/soldiers\/[^/]+$/.test(pathname)) {
    return {
      htmlCacheName: "soldier-html-shell-v1",
      htmlKey: `${origin}/soldiers/__html_shell__`,
      rscCacheName: "soldier-rsc-shell-v1",
      rscKey: `${origin}/soldiers/__rsc_shell__`,
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

    swLog("fetch", url.pathname, event.request.mode);

    if (event.request.mode === "navigate") {
      event.respondWith(handleHtmlShell(event, shell.htmlKey, shell.htmlCacheName));
    } else {
      event.respondWith(handleRscShell(event, shell.rscKey, shell.rscCacheName));
    }
  }
);

// Cache-first with network update for HTML shells.
//
// Serve the cached shell immediately (instant load, no auth redirect risk),
// then update the cache from the network in the background. If no cache exists
// yet, fall back to network.
//
// This is critical for iOS standalone PWA: when iOS kills and resumes the app,
// it reloads the URL. A network-first approach risks hitting the server's auth
// redirect (302 → /login), which iOS interprets as a rapid-reload loop and
// shows "A problem repeatedly occurred". Serving the cached shell lets React
// boot and PowerSync reconnect from IndexedDB.
async function handleHtmlShell(
  event: FetchEvent,
  shellKey: string,
  cacheName: string
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const shellReq = new Request(shellKey);

  // 1. Check cache first.
  const cached = await cache.match(shellReq);
  if (cached) {
    swLog("html-shell CACHE HIT", shellKey);
    // Update cache in the background (fire-and-forget, but don't await —
    // iOS terminates SW async work aggressively after respondWith()).
    fetchAndCache(event.request, shellReq, cache);
    return cached;
  }

  // 2. No cache — must go to network.
  swLog("html-shell CACHE MISS, fetching network", shellKey);
  const response = await fetch(event.request).catch(() => undefined);

  if (response?.ok && !response.redirected) {
    swLog("html-shell network OK, caching", shellKey);
    const cloned = response.clone();
    cache.put(shellReq, cloned);
    return response;
  }

  swLog("html-shell network failed/redirected", shellKey, response?.status, response?.redirected);

  // Return the response if we got one (e.g. redirect to /login when session
  // is genuinely expired), otherwise show a static offline page.
  if (response) return response;

  return offlineFallbackResponse();
}

// Fire-and-forget network fetch to update a cached shell.
// Errors are silently swallowed — the user already has a cached response.
function fetchAndCache(request: Request, shellReq: Request, cache: Cache) {
  fetch(request)
    .then((res) => {
      if (res.ok && !res.redirected) {
        swLog("background refresh OK", shellReq.url);
        cache.put(shellReq, res);
      } else {
        swLog("background refresh skipped", shellReq.url, res.status, res.redirected);
      }
    })
    .catch(() => {
      swLog("background refresh failed (offline?)", shellReq.url);
    });
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

// Cache-first with network update for RSC payloads.
// Same strategy as HTML shells.
async function handleRscShell(
  _event: FetchEvent,
  shellKey: string,
  cacheName: string
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const shellReq = new Request(shellKey);

  const cached = await cache.match(shellReq);
  if (cached) {
    swLog("rsc-shell CACHE HIT", shellKey);
    fetchAndCache(_event.request, shellReq, cache);
    return cached;
  }

  swLog("rsc-shell CACHE MISS, fetching network", shellKey);
  const response = await fetch(_event.request).catch(() => undefined);

  if (response?.ok && !response.redirected) {
    swLog("rsc-shell network OK, caching", shellKey);
    const cloned = response.clone();
    cache.put(shellReq, cloned);
    return response;
  }

  swLog("rsc-shell network failed/redirected", shellKey, response?.status);
  if (response) return response;

  return new Response("", { status: 503 });
}

const serwist = new Serwist({
  precacheEntries,
  skipWaiting: true,
  clientsClaim: true,
  // navigationPreload is DISABLED. Safari (pre-18.5) has a critical bug where
  // cached navigation-preload responses with redirects cause the SW to receive
  // a stale/corrupt preload response on subsequent navigations, leading to
  // "A problem repeatedly occurred" on iOS standalone PWA. Since we use
  // cache-first for shell routes anyway, the preload provides no benefit.
  navigationPreload: false,
  runtimeCaching: [
    // API routes and PowerSync: never cache, always network-only.
    {
      matcher: /\/(api|@powersync)\//,
      handler: new NetworkOnly(),
    },
    // Everything else (pages, fonts, images, JS/CSS not in precache):
    // use the default Next.js-aware caching strategies from Serwist.
    ...defaultCache,
  ],
});

serwist.addEventListeners();
