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

    if (event.request.mode === "navigate") {
      event.respondWith(handleHtmlShell(event, shell.htmlKey, shell.htmlCacheName));
    } else {
      event.respondWith(handleRscShell(event, shell.rscKey, shell.rscCacheName));
    }
  }
);

// Network-first with cache fallback for HTML shells.
//
// Try the network; if it returns a valid (200, non-redirected) response, cache
// it and serve it. If the network fails or returns a redirect/error, fall back
// to the cached shell. This is critical for iOS standalone PWA: when iOS kills
// and resumes the app, the cached shell lets React boot from IndexedDB without
// hitting the server's auth redirect.
//
// No background refresh — iOS aggressively terminates SW async work after
// respondWith(), which can corrupt cache entries.
async function handleHtmlShell(
  event: FetchEvent,
  shellKey: string,
  cacheName: string
): Promise<Response> {
  const cache = await caches.open(cacheName);

  // Try network first.
  const preload = await Promise.resolve(event.preloadResponse).catch(() => undefined);
  const response = preload ?? (await fetch(event.request).catch(() => undefined));

  if (response?.ok && !response.redirected) {
    const cloned = response.clone();
    cache.put(new Request(shellKey), cloned);
    return response;
  }

  // Network failed or returned redirect/error — serve cached shell.
  const cached = await cache.match(new Request(shellKey));
  if (cached) return cached;

  // No network, no cache — return the response if we got one (e.g. redirect),
  // otherwise show offline fallback.
  if (response) return response;

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
    a { display: inline-block; padding: 0.625rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; text-decoration: none; }
    .primary { background: #273617; color: #fff; margin-bottom: 0.5rem; }
    .secondary { border: 1px solid #d1d5db; color: #374151; }
  </style>
</head>
<body>
  <div class="card">
    <h1>אין חיבור לרשת</h1>
    <p>הדף הזה לא זמין במצב לא מקוון. חזור לרשת כדי לפתוח אותו, או נווט לדף שביקרת בו בעבר.</p>
    <a href="/" class="primary">חזרה לדף הבית</a><br>
    <a href="javascript:history.back()" class="secondary">חזרה אחורה</a>
  </div>
</body>
</html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// Network-first with cache fallback for RSC payloads.
// Same strategy as HTML shells.
async function handleRscShell(
  event: FetchEvent,
  shellKey: string,
  cacheName: string
): Promise<Response> {
  const cache = await caches.open(cacheName);

  const response = await fetch(event.request).catch(() => undefined);

  if (response?.ok && !response.redirected) {
    const cloned = response.clone();
    cache.put(new Request(shellKey), cloned);
    return response;
  }

  const cached = await cache.match(new Request(shellKey));
  if (cached) return cached;

  if (response) return response;

  return new Response("", { status: 503 });
}

const serwist = new Serwist({
  precacheEntries,
  skipWaiting: true,
  clientsClaim: true,
  // navigationPreload lets the browser start the page fetch in parallel with
  // SW startup; the SW uses that pre-fetched response instead of making its
  // own navigation-mode fetch (which can fail inside a SW in some browsers).
  navigationPreload: true,
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
