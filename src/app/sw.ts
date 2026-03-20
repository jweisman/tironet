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
// Build identity — derived from precache manifest content hashes.
// Changes on every deployment so shell caches are automatically versioned.
// ---------------------------------------------------------------------------
const precacheEntries = (self.__SW_MANIFEST ?? []).filter((entry) => {
  const url = typeof entry === "string" ? entry : entry.url;
  return url.startsWith("/_next/static/");
});

// Compute a short build hash from the first few precache revision strings.
// This changes whenever JS/CSS bundles change (i.e. every deployment).
function computeBuildHash(): string {
  const revisions = precacheEntries
    .slice(0, 8)
    .map((e) => (typeof e === "string" ? e : e.revision ?? e.url))
    .join("|");
  // Simple string hash — only needs to be unique per build, not cryptographic.
  let hash = 0;
  for (let i = 0; i < revisions.length; i++) {
    hash = ((hash << 5) - hash + revisions.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

const BUILD_ID = computeBuildHash();
const SHELL_CACHE_PREFIX = "shell-";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const LOG_PREFIX = "[SW]";
function swLog(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

swLog("loaded, build", BUILD_ID);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
(self as unknown as { addEventListener(t: string, h: (e: ExtendableEvent) => void): void }).addEventListener(
  "activate",
  (event) => {
    swLog("activate, build", BUILD_ID);
    event.waitUntil(cleanAndPrepopulateCaches());
  }
);

// Client-triggered cache warming. Next.js Link navigations use RSC payloads
// (mode: "cors"), not full navigations (mode: "navigate"), so the SW never
// gets a chance to cache shells during normal browsing. The client sends a
// WARM_SHELLS message after authentication to ensure shells are cached.
type MessageEvent = Event & { data: unknown; waitUntil?(p: Promise<unknown>): void };
(self as unknown as { addEventListener(t: string, h: (e: MessageEvent) => void): void }).addEventListener(
  "message",
  (event) => {
    if (
      event.data &&
      typeof event.data === "object" &&
      (event.data as Record<string, unknown>).type === "WARM_SHELLS"
    ) {
      swLog("warming shells from client message");
      const p = warmShellCache();
      if (event.waitUntil) event.waitUntil(p);
    }
  }
);

// Fixed cache name shared between SW and main thread. The SW clears and
// repopulates on activation (i.e. on every deployment), so no build-hash
// suffix is needed — the activation lifecycle handles versioning.
const SHELL_CACHE_NAME = "app-shells";

async function cleanAndPrepopulateCaches() {
  // 1. Delete ALL caches from previous builds.
  //    - Our shell caches: prefixed with "shell-"
  //    - Serwist defaultCache page/RSC caches: version-specific, stale after deploy
  const allCaches = await caches.keys();
  const staleCachePrefixes = [
    SHELL_CACHE_PREFIX,      // old build-hashed shell caches ("shell-xxx")
    "pages-rsc-prefetch",    // Serwist RSC prefetch cache
    "pages-rsc",             // Serwist RSC cache
    "pages",                 // Serwist pages cache
    "others",                // Serwist catch-all cache
  ];
  // Also delete per-route caches from the previous SW version
  const staleCacheExact = [
    "activity-rsc-shell-v1",
    "soldier-rsc-shell-v1",
    "activities-list-rsc-shell-v1",
    "soldiers-list-rsc-shell-v1",
    "home-rsc-shell-v1",
  ];
  for (const name of allCaches) {
    // Keep current shell cache
    if (name === SHELL_CACHE_NAME) continue;
    // Delete caches matching stale prefixes or exact names
    if (
      staleCachePrefixes.some((prefix) => name.startsWith(prefix)) ||
      staleCacheExact.includes(name)
    ) {
      await caches.delete(name);
      swLog("deleted stale cache", name);
    }
  }

  // 2. Prepopulate shell caches.
  await warmShellCache();
}

// Shared logic: fetch shell routes and store in cache.
// Called from activation (prepopulation) and from client message (WARM_SHELLS).
const SHELL_ROUTES = [
  "/home",
  "/activities",
  "/soldiers",
  "/activities/_",   // detail page shell (dummy slug — same HTML for any ID)
  "/soldiers/_",     // detail page shell
];

async function warmShellCache() {
  const origin = (self as unknown as { location: { origin: string } }).location.origin;
  const cache = await caches.open(SHELL_CACHE_NAME);

  for (const path of SHELL_ROUTES) {
    try {
      const res = await fetch(path, { credentials: "same-origin" });
      if (res.ok && !res.redirected) {
        const shell = resolveShellRoute(path, origin);
        if (shell) {
          await cache.put(new Request(shell.htmlKey), res);
          swLog("cached shell", path, "→", shell.htmlKey);
        }
      } else {
        swLog("shell skipped (not ok or redirected)", path, res.status);
      }
    } catch {
      swLog("shell fetch failed (offline?)", path);
    }
  }
}

// ---------------------------------------------------------------------------
// App shell routing
// ---------------------------------------------------------------------------
//
// All app pages are client-rendered with data from PowerSync (local SQLite).
// The server returns the same HTML shell regardless of state, so we cache
// one copy per route pattern and serve it offline.
//
// Only navigation (HTML) requests are cached. RSC payloads are NOT cached
// because they are version-specific — serving stale RSC after a deployment
// causes 400 errors that trigger Next.js MPA fallback reloads.
//
// This listener runs BEFORE serwist.addEventListeners() so it calls
// respondWith() first; unmatched requests fall through to Serwist.

function resolveShellRoute(pathname: string, origin: string): {
  htmlKey: string;
} | null {
  // List pages (exact path)
  if (pathname === "/home" || pathname === "/activities" || pathname === "/soldiers") {
    return { htmlKey: `${origin}${pathname}` };
  }

  // Detail pages (UUID-parameterized — cache under a canonical key)
  if (/^\/activities\/[^/]+$/.test(pathname)) {
    return { htmlKey: `${origin}/activities/__shell__` };
  }
  if (/^\/soldiers\/[^/]+$/.test(pathname)) {
    return { htmlKey: `${origin}/soldiers/__shell__` };
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
    // are NOT cached because they are version-specific.
    if (event.request.mode !== "navigate") return;

    swLog("fetch", url.pathname, "navigate");
    event.respondWith(handleHtmlShell(event, shell.htmlKey));
  }
);

// Network-first with cache fallback for HTML shells.
async function handleHtmlShell(
  event: FetchEvent,
  shellKey: string
): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE_NAME);
  const shellReq = new Request(shellKey);

  // 1. Try network first.
  const response = await fetch(event.request).catch(() => undefined);

  if (response?.ok && !response.redirected) {
    swLog("html-shell network OK, caching", shellKey);
    // Clone synchronously before the body is consumed.
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
