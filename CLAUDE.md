# Tironet — Claude Context

This file captures architectural decisions, constraints, and gotchas for Claude when working on this codebase.

## Tech Stack Summary

- **Next.js 16** App Router, TypeScript, Tailwind CSS v4
- **NextAuth v5** JWT strategy, Google OAuth + email magic link + WhatsApp OTP (Twilio Verify)
- **PostgreSQL** via Prisma ORM
- **PowerSync** (`@powersync/web` + `@powersync/react`) for offline-first sync — Sync Streams edition 3
- **PWA** via `@serwist/turbopack` (service worker compiled via esbuild route handler)

## PowerSync Architecture

### Why Sync Streams (not Sync Rules)

We use **PowerSync Sync Streams** (`edition: 3`, recommended for all new apps as of 2026) rather than the legacy Sync Rules YAML format. Sync Streams supports `JOIN`, subqueries, and CTEs — avoiding the need to denormalize foreign keys into every table just for sync scoping.

Config lives in [`src/lib/powersync/sync-config.yaml`](src/lib/powersync/sync-config.yaml), mounted into the PowerSync Docker container. The main config is [`powersync.config.yaml`](powersync.config.yaml).

### JWT claims for sync scoping

The `/api/powersync/token` endpoint signs a JWT with three custom claims resolved from the user's `UserCycleAssignment` rows:

| Claim | Type | Meaning |
|---|---|---|
| `cycle_ids` | `string[]` | All cycles the user is assigned to |
| `platoon_ids` | `string[]` | All platoons the user can see (pre-expanded: company commanders get all platoons in their company) |
| `squad_id` | `string \| null` | The squad for squad commanders; null otherwise |

Sync streams use `auth.parameter('cycle_ids')` etc. to filter rows server-side. No client-side subscription parameters are needed — all streams use `auto_subscribe: true`.

### Sync stream query patterns for `auth.parameter()`

`IN auth.parameter('key')` works correctly when the filtered column is on the **primary (FROM) table**:

```yaml
query: >
  SELECT id, name FROM activities
  WHERE platoon_id IN auth.parameter('platoon_ids')
```

When the filtered column is on a **joined table** (not the primary table), use a **subquery** instead. The `json_each` JOIN pattern (e.g. `JOIN json_each(auth.parameter('platoon_ids')) AS p ON a.platoon_id = p.value`) appears valid per the docs but causes PowerSync to key buckets incorrectly (by the joined table's row ID instead of the parameter value), resulting in all rows being processed as REMOVE operations and 0 rows in the local DB.

Correct pattern for `activity_reports`, which has no `platoon_id` of its own:

```yaml
query: >
  SELECT id, activity_id, soldier_id, result, grade1, grade2, grade3, grade4, grade5, grade6, note
  FROM activity_reports
  WHERE activity_id IN (
    SELECT id FROM activities WHERE platoon_id IN auth.parameter('platoon_ids')
  )
```

**Debugging tip:** if a stream appears in `ps_buckets` with non-zero `count_at_last` but the actual table is empty and `ps_oplog` is also empty after a full sync (`hasSynced: true`), the rows were received as REMOVE operations — likely a bucket keying mismatch from the wrong query pattern.

### Local Docker setup quirks

- **`sslmode: disable`** must be set as a top-level field in `powersync.config.yaml` under the connection — NOT as a `?sslmode=disable` URL parameter. The pgwire library used by PowerSync ignores URL-embedded SSL params.
- **MongoDB must run as a replica set** (`--replSet rs0`). Standalone MongoDB is not supported by PowerSync. After first launch, `rs.initiate()` must be run once manually (see README).
- **PostgreSQL publication** must be created once: `CREATE PUBLICATION powersync FOR ALL TABLES`. Required for WAL logical replication.
- **Docker Compose reads `.env`**, not `.env.local`. Next.js reads `.env.local`. Keep both files in sync for shared variables.
- **`docker compose restart`** does not re-read `.env`. Use `docker compose up -d` to pick up env changes.
- **`docker-compose.yml` `environment:` section is the source of truth** for what env vars reach the container. Variables in `.env` are only injected if explicitly listed there — `!env` in `powersync.config.yaml` reads from the container environment, not directly from `.env`.

### JWT audience configuration

The PowerSync service requires a valid `aud` claim in every JWT. The allowed values are configured via `client_auth.audience` (singular) in `powersync.config.yaml` — **not** `audiences` (plural). Source confirmed from `compound-config-collector.js`: `baseConfig.client_auth?.audience ?? []`.

The `aud` value in tokens must match `NEXT_PUBLIC_POWERSYNC_URL` (e.g. `http://localhost:8080` in dev). Both the token endpoint and `powersync.config.yaml` must agree.

### VFS: must use OPFSCoopSyncVFS (not IDBBatchAtomicVFS)

The default wa-sqlite VFS (`IDBBatchAtomicVFS`) causes iOS Safari to crash with "A problem repeatedly occurred". Root cause: IDBBatchAtomicVFS triggers stack overflows and exhausts WebKit's WASM gigacage memory region (WebKit bug 269937). iOS's JetSam daemon kills the WebContent process, and two rapid kills trigger the crash screen.

**Fix:** `database.ts` explicitly sets `vfs: WASQLiteVFS.OPFSCoopSyncVFS`, which uses the Origin Private File System API instead of IndexedDB. This is faster and avoids the crash path entirely.

**Caveat:** OPFS is not available in Safari Private Browsing mode. If incognito support is needed, add a runtime check and fall back to IDBBatchAtomicVFS.

### UMD worker setup for Next.js + Turbopack

Both PowerSync workers must be pointed at the pre-built UMD files. Without this, Turbopack tries to bundle them from source and hangs:

```typescript
// database.ts
new WASQLiteOpenFactory({
  vfs: WASQLiteVFS.OPFSCoopSyncVFS,  // REQUIRED — IDBBatchAtomicVFS crashes iOS Safari
  worker: "/@powersync/worker/WASQLiteDB.umd.js",  // DB worker
  ...
})
new PowerSyncDatabase({
  sync: { worker: "/@powersync/worker/SharedSyncImplementation.umd.js" },  // sync worker
  ...
})
```

The UMD files are served from `public/@powersync/` (copied by `postinstall`). There is a path bug in `@powersync/web`'s webpack bundle: `WASQLiteDB.umd.js` computes its chunk public path as `../` relative to its script URL, so chunk files land one level up from `worker/`. The postinstall `cp` step fixes this:

```json
"postinstall": "prisma generate && powersync-web copy-assets -o public && cp public/@powersync/worker/*.umd.js public/@powersync/"
```

`public/@powersync/` is gitignored — it is regenerated on every `npm install`.

## PowerSync + React Rendering Gotchas

### `useQuery` loading state is unreliable for dependent queries

`useQuery` from `@powersync/react` runs against local SQLite synchronously. When a query's params change (e.g. because a prior query's result resolved and updated the params), the `loading` flag may never transition through `true` — the new result is available immediately. Do not rely on `loading: true` to gate downstream rendering.

### `ActivityDetail` uses `useState(initialData)` — key on squad IDs + soldier presence

`ActivityDetail` initializes its internal state with `useState(initialData)` and never syncs with prop changes. When the page builds `localData` from chained `useQuery` calls (activity → platoon params → squads → soldiers), React may mount `ActivityDetail` with partially-loaded data (correct squads, empty soldiers) before soldiers resolve in the next render cycle.

**Fix:** key the component on squad IDs AND a binary "has soldiers" flag so it remounts exactly once when soldiers first arrive, but does NOT remount as additional soldiers trickle in during incremental sync (which would discard unsaved edits):

```tsx
<ActivityDetail
  key={`${data.squads.map(s => s.id).join(",")}-${data.squads.some(s => s.soldiers.length > 0) ? 1 : 0}`}
  initialData={data}
/>
```

**Do NOT** use the exact soldier count in the key — incremental sync updates would remount the component repeatedly, discarding any in-progress score/note edits.

If you ever add another `useState(initialData)` component fed by chained `useQuery` params, apply the same pattern.

### `ActivityDetail` debounce cleanup

`ActivityDetail` stores `setTimeout` handles in a `debounceRefs` Map for score/note auto-save. A `useEffect` cleanup clears all pending timeouts on unmount to prevent stale callbacks firing against unmounted state. If you add more debounced refs, follow the same cleanup pattern.

### Activity detail page uses activity-cycle assignment, not global context

The activity detail page (`/activities/[id]/page.tsx`) resolves the user's role and squad from the assignment matching `activity.cycle_id`, not from `selectedAssignment` in `CycleContext`. This handles users with assignments in multiple cycles correctly (e.g. squad_commander in a past cycle + platoon_commander in the current one).

## Offline-First Writes via PowerSync

### Pattern: write to local DB, let the connector sync

All user mutations that need to work offline must write to the local PowerSync SQLite DB via `db.execute()` rather than calling the API directly. PowerSync queues the write as a CRUD operation and the connector uploads it when connectivity is restored.

```typescript
// In a component:
const db = usePowerSync(); // from @powersync/react

// UPDATE existing row
await db.execute(
  "UPDATE activity_reports SET result = ?, grade1 = ?, grade2 = ?, grade3 = ?, grade4 = ?, grade5 = ?, grade6 = ?, note = ? WHERE id = ?",
  [result, grade1, grade2, grade3, grade4, grade5, grade6, note, id]
);

// INSERT new row — always generate the UUID client-side
const newId = crypto.randomUUID();
await db.execute(
  "INSERT INTO activity_reports (id, activity_id, soldier_id, result, grade1, grade2, grade3, grade4, grade5, grade6, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  [newId, activityId, soldierId, result, grade1, grade2, grade3, grade4, grade5, grade6, note]
);
```

Writes are **instant and optimistic** — no network round-trip, no loading state needed. `useQuery` on the same table reacts immediately. Update local component state manually when `useState` holds a derived copy (e.g. `reports` Map in `ActivityDetail`).

### Connector: `uploadData` uploads the CRUD queue

`src/lib/powersync/connector.ts` uploads queued writes via `uploadData()`. Key rules:

1. **Network errors (`TypeError: Failed to fetch`)** — do not call `transaction.complete()`. PowerSync retries automatically when connectivity is restored.
2. **4xx client errors (bad data, permission denied)** — call `transaction.complete()` to drain the failed operation. Retrying will never succeed and would block all subsequent uploads. The error is logged with a warning.
3. **5xx server errors** — do not call `transaction.complete()`. PowerSync retries automatically.
4. **PowerSync CRUD `opData` uses snake_case** (matching the local schema column names). Transform to camelCase before calling the API. Example: `opData.activity_id` → `activityId`.
5. **PUT operations must pass the client-generated `id`** to the server so the server creates the record with the same UUID the local DB already has. Without this, the server generates a new UUID and PowerSync syncs back a duplicate record with a mismatched ID.

### API: accept client-generated `id` on POST (upsert)

When the connector uploads a PUT (INSERT that was created offline), it sends the client UUID as `id`. The POST endpoint must accept an optional `id` field and pass it to the Prisma `create` body:

```typescript
// zod schema
id: z.string().uuid().optional(),

// Prisma upsert
create: {
  ...(clientId ? { id: clientId } : {}),
  activityId, soldierId, result, ...
},
```

The upsert `where` clause uses the composite unique key (e.g. `activityId_soldierId`), so if the record already exists the `id` is ignored and the row is updated in place.

### `init()` before `connect()` — offline DB access

`PowerSyncProvider` calls `db.init()` first, then `db.connect(connector)`. `init()` opens the local SQLite DB and creates tables from the schema — it is fast and requires no network. `connect()` additionally starts the sync stream, which calls `fetchCredentials()` and may fail offline. By calling `init()` first, `useQuery()` returns previously synced data immediately, even when offline.

**Do not** gate `init()` or `connect()` on authentication state (e.g. `useSession()`). When offline, NextAuth's session refresh fails and `status` may flip to `"unauthenticated"`, which would disconnect the DB and break offline queries.

If `init()` itself fails (OPFS corruption, quota exceeded, Safari Private Browsing), `PowerSyncProvider` shows a persistent banner ("מצב לא מקוון אינו זמין") so users know offline mode is unavailable. This is distinguished from `connect()` failure (offline, expected) by checking `!localDb.connected` after the catch.

### Token fetch throttling and auth error handling

PowerSync retries `fetchCredentials()` rapidly when the sync stream drops. Without throttling, this fires dozens of failing `/api/powersync/token` fetches per second while offline. `connector.ts` implements **exponential backoff** (2s → 4s → 8s → ... capped at 30s) that resets on success.

**Auth errors (401/403)** are distinguished from network errors. When the token endpoint returns 401 or 403 (session expired or revoked), the connector clears its cached token and throws a distinguishable `"Authentication expired (${status})"` error. This allows callers to prompt re-login instead of silently retrying with dead credentials.

### Offline indicator

`useOnlineStatus()` in `src/hooks/useOnlineStatus.ts` combines two signals:
- `navigator.onLine` — flips **immediately** when the network drops
- `status.connected` from PowerSync — can take 10–30s to flip (WebSocket timeout)

Use `browserOnline && status.connected` so the banner appears instantly. `hasPendingUploads` is true when `status.dataFlowStatus.uploadError` is set (failed upload attempt while offline) — this drives the "שינויים ממתינים לסנכרון" pill in `OfflineBanner`.

**Debounce:** online → offline transitions are debounced by 2 seconds so brief network blips don't flash the banner. Offline → online is instant (no delay).

The offline state is persisted to `localStorage` (`tironet:offline` key) so the banner appears immediately after MPA fallback reloads that reset React state.

### NextAuth JWT maxAge

The JWT `maxAge` is set to **1 day** (86400 seconds) so that `cycleAssignments` and PowerSync sync claims are refreshed from the database daily. The NextAuth default is 30 days, which means role changes (e.g. promotion to platoon commander) wouldn't take effect in the sync scope for up to a month.

## Data Model Constraints

### Squads cannot be reassigned between platoons

The `Soldier` → `Squad` → `Platoon` hierarchy is treated as immutable within a cycle. The API enforces this:
- `PATCH /api/admin/structure/[id]` only accepts `name` — no `platoonId` change
- `PATCH /api/soldiers/[id]` only accepts profile fields — no `squadId` change

This matters because PowerSync scopes `activity_reports` to users via a JOIN on `activities.platoon_id`. If a squad moved platoons mid-cycle, existing reports would fall out of sync scope. Do not add squad reassignment without also rethinking the sync strategy.

### Soldiers cannot be transferred between squads

Similarly, `Soldier.squadId` is write-once. The "transferred" status (`SoldierStatus.transferred`) marks a soldier as inactive rather than moving them.

## Requests (בקשות) Workflow

### Request types

Three types: `leave` (יציאה), `medical` (רפואה), `hardship` (ת"ש). Each has type-specific fields defined in the Prisma schema and PowerSync local schema.

### Workflow state machine

Requests use a `status` + `assignedRole` pair to track progress. `assignedRole` is nullable — `null` means the workflow is complete (terminal state).

**Creation routing:**
- Squad commander creates → assigned to `platoon_commander`
- Platoon commander creates → assigned to `company_commander` (skips platoon approval)
- Admin creates → assigned to `platoon_commander`

**Approval chain (leave & medical):**
```
squad_commander creates → platoon_commander (approve/deny)
  → if approved: company_commander (approve/deny)
    → if approved: platoon_commander (acknowledge) → squad_commander (acknowledge) → done (assignedRole = null)
    → if denied: platoon_commander (acknowledge) → squad_commander (acknowledge) → done
  → if denied: squad_commander (acknowledge) → done
```

**Hardship requests** skip company commander — platoon commander approval goes directly to squad commander acknowledge.

**Key implementation detail:** the `acknowledge` action passes the decision down the chain without changing the status. Only approve/deny change the status.

### Denial reason

When denying a request, commanders can provide a free-text denial reason. The deny button opens a dialog with an optional text field. The reason is stored in `Request.denialReason` and displayed on the detail page for denied requests.

### Offline writes

Request creation and workflow actions (approve/deny/acknowledge) write to the local PowerSync SQLite DB via `db.execute()`. The connector uploads them via PATCH/POST to the API. The `uploadData` handler in `connector.ts` maps snake_case columns to camelCase for the API.

### Request scoping (`getRequestScope`)

`src/lib/api/request-scope.ts` provides `getRequestScope(cycleId)` which resolves the user's role, permissions (`canCreate`), and `soldierIds` they can access for a given cycle. This is used by both the list and detail API routes. Admin users have `canCreate: true` and see all soldiers.

### List page filtering

The requests list page (`/requests`) has two tabs:
- **Open** (`פתוחות`): requests where `assignedRole !== null` (still in the workflow)
- **Approved** (`אושרו`): requests where `status === "approved" && assignedRole === null` (workflow complete)

Open requests are sorted with "assigned to me" first.

## API Conventions

- All protected routes call `auth()` from `@/lib/auth/auth` and check `session.user`
- Admin routes use `requireAdmin()` from `@/lib/api/admin-guard`
- Non-admin data access is scoped via `getActivityScope()` (activities) or `getRequestScope()` (requests) which resolve the user's role and unit IDs for a given cycle
- Polymorphic FK: `UserCycleAssignment.unitId` points to `companies`, `platoons`, or `squads` depending on `unitType`. Referential integrity is enforced at the application layer, not by the DB.

## Bulk Import Pattern (Spreadsheet Upload)

Both soldiers and activities support bulk import from Excel/CSV spreadsheets. The pattern is the same:

1. **Client-side dialog** parses the file with `xlsx`, validates rows against known values (squad names, activity type names), shows a preview table with per-row errors, and POSTs valid rows to a `/bulk` API route.
2. **API route** validates with Zod, checks scope permissions, and creates records in a Prisma `$transaction`.

### Activity bulk import specifics

- **UI:** `BulkImportActivitiesDialog` in `src/components/activities/`. User selects one platoon for the entire batch. Template uses real activity type names from `/api/activity-types`.
- **API:** `POST /api/activities/bulk` — only `platoon_commander` (own platoon) and `admin` can create. Activity types are matched by UUID (resolved client-side by name). Duplicates (same name + date + type + platoon) are skipped, not errored.
- **Defaults:** `isRequired` = true, `status` = draft (consistent with single-create form).
- **Excel date handling:** Dates in spreadsheets may arrive as Excel serial numbers (e.g. `46113`) when using `raw: true` in `sheet_to_json`. The parser uses `XLSX.SSF.parse_date_code()` to convert these. String dates in `YYYY-MM-DD` format also work.

### Activity report bulk import (column mapping)

Unlike soldier/activity import, report import uses **user-defined column mapping** because spreadsheet formats vary. Key differences from the other bulk imports:

- **UI:** `BulkImportReportsDialog` in `src/components/activities/`. Accessed from the activity detail page ("ייבוא דיווחים" button). Only visible to users with `canEditReports`.
- **No API route** — reports are written to the local PowerSync SQLite DB via `db.execute()`, matching the existing `saveReport` pattern. The connector handles upload automatically.
- **Column mapping step:** After file upload, the user maps spreadsheet columns to report fields (personal number, result, note, and dynamic score columns based on activity type). Mappings are auto-detected from known Hebrew header names and persisted to `localStorage` keyed by `activityTypeId` (`tironet:report-mapping:${activityTypeId}`).
- **Soldier lookup:** Soldiers are matched by `idNumber` (מספר אישי). The `SOLDIERS_QUERY` in the activity detail page fetches `id_number` for this purpose.
- **Result values:** Accepts Hebrew (עבר/נכשל/לא רלוונטי), English (passed/failed/na), and numeric (1/0).
- **Upsert behavior:** Existing reports are overwritten (same as manual edits). New reports are INSERTed with `crypto.randomUUID()`.

### Soldier bulk import

- **UI:** `BulkImportDialog` in `src/components/soldiers/`. Squad can be selected per-batch or read from a column in the file.
- **API:** `POST /api/soldiers/bulk` — scoped by role (squad/platoon/company commander or admin). Returns `activeActivityCount` to trigger "mark as N/A" prompt for late joiners.

## PWA / Service Worker Architecture

### Why `@serwist/turbopack` (not `@ducanh2912/next-pwa`)

Next.js 16 uses Turbopack for production builds. `@ducanh2912/next-pwa` is webpack-based and its plugin never runs under Turbopack, so no service worker is generated. `@serwist/turbopack` compiles the SW via an esbuild-powered Next.js **route handler** at `/serwist/[path]`, which works regardless of bundler.

Key files:
- `src/app/sw.ts` — service worker source
- `src/app/serwist/[path]/route.ts` — compiles and serves `sw.ts` at `/serwist/sw.js`
- `src/app/serwist-provider.tsx` — client wrapper; disabled in development
- `src/app/layout.tsx` — wraps app in `<SerwistProvider>`

### Precache filtering

Only `/_next/static/` assets (hashed filenames) are precached. Page HTML routes are excluded because they require SSR auth checks and would fail with 302 redirects during SW installation, breaking the entire SW.

### App shell model for detail routes (`/activities/[id]`, `/soldiers/[id]`)

These are `"use client"` pages — the server returns the **same HTML shell for every UUID**. Data comes entirely from PowerSync (local SQLite via OPFS). This enables caching one generic shell per route pattern so any detail page is accessible offline once a single detail was visited.

Only **navigation-mode** (HTML) requests are cached as shells. RSC payloads are **never cached** because they are version-specific — serving stale RSC after a deployment causes 400 errors that trigger Next.js MPA fallback reloads. The SW's `runtimeCaching` includes a `NetworkOnly` matcher for all RSC/navigate requests before `...defaultCache` to prevent Serwist's default `pages-rsc-prefetch` / `pages-rsc` / `pages` caches from staling.

The custom `fetch` listener in `sw.ts` is registered **before** `serwist.addEventListeners()` so it calls `respondWith()` first; unmatched requests fall through to Serwist's handlers.

The shell cache name includes a build hash derived from precache manifest content hashes (`app-shells-${BUILD_ID}`), so each deployment automatically gets its own cache. On SW activation, all caches from prior builds (matching `app-shells-*`, `shell-*`, and Serwist page caches) are deleted and list-page shells (`/home`, `/activities`, `/soldiers`) are repopulated from the network.

Shell warming fetches use a 5-second `AbortController` timeout per request, so slow 3G connections don't hang SW activation. Timed-out shells are skipped and cached on first real navigation instead.

**Critical gotcha:** call `response.clone()` synchronously (before any `await`) when caching. If you call it inside an async `.then()` callback, the response body may already be consumed by the time the clone runs, causing a "Response body is already used" error and an empty cache entry.

### `useParams()` hydration baking — the app shell gotcha

Next.js bakes `useParams()` into the server-rendered HTML/RSC hydration data. When the SW serves a cached shell from `/soldiers/_` for `/soldiers/<real-uuid>`, `useParams()` returns `"_"` instead of the real UUID. This causes queries to return 0 rows and the page shows "not found".

**Fix:** each detail page reads `window.location.pathname` after hydration to get the real ID:

```tsx
const [soldierId, setSoldierId] = useState(params.id);
useEffect(() => {
  const match = window.location.pathname.match(/^\/soldiers\/([^/]+)$/);
  if (match && match[1] !== soldierId) setSoldierId(match[1]);
}, []);
```

Apply this pattern to any new detail page that uses the app shell caching model.

### Client-triggered shell warming via `postMessage`

Next.js `<Link>` navigations use RSC payloads (`mode: "cors"`), not full navigations (`mode: "navigate"`). The SW's fetch handler only triggers on `navigate`, so it never caches shells during normal in-app browsing. To ensure shells are cached, `serwist-provider.tsx` sends a `WARM_SHELLS` message inside the `.then()` callback after successful SW registration, triggering the SW to proactively fetch and cache all shell routes (`/home`, `/activities`, `/soldiers`, `/activities/_`, `/soldiers/_`). The message is only sent after registration succeeds — if registration fails, no message is sent (there is no controller to receive it).

### Offline fallback for unsupported pages

Pages without a cached shell (e.g. `/admin`, `/profile`) fall through to `handleNavigateFallback()` which tries the network and returns an inline offline HTML page on failure. This page includes "try again" and "go to home page" buttons so users aren't stuck.

**Critical:** `handleNavigateFallback` must **exclude `/api/` paths**. When the custom fetch listener and Serwist's `NetworkOnly` `/api/` matcher both handle the same navigate request, two `fetch()` calls hit the server. This breaks one-time-use tokens (e.g. NextAuth email verification: the first request consumes the token, the second gets P2025 → `?error=Verification`). The guard `!url.pathname.startsWith("/api/")` ensures API navigations (like clicking a magic link) are handled solely by Serwist.

### `navigationPreload: false`

Navigation preload is **disabled**. Safari (pre-18.5) has a critical bug where cached navigation-preload responses with redirects cause the SW to receive a stale/corrupt preload response on subsequent navigations. Since the shell handler does its own `fetch()`, the preload provides no benefit.

### Service worker registration (no auto-reload on update)

`serwist-provider.tsx` uses manual `navigator.serviceWorker.register()` instead of `@serwist/turbopack/react`'s `SerwistProvider`. The library's provider automatically reloads the page on `controllerchange` (when a new SW takes control via `skipWaiting` + `clientsClaim`). On iOS, that reload combined with any RSC error recovery = two rapid reloads = "A problem repeatedly occurred" crash. The manual registration intentionally omits the `controllerchange` listener — the new SW silently takes over and the next user navigation uses its cached content.

### `AUTH_TRUST_HOST=true`

Required when the dev server runs on a non-standard port (e.g. 3001). NextAuth validates the `Host` header and throws `UntrustedHost` — crashing the server — unless this is set.

### TypeScript in `sw.ts`

The project tsconfig does not include the WebWorker lib, so `FetchEvent`, `ServiceWorkerGlobalScope.addEventListener`, etc. are not available as global types. `sw.ts` declares a minimal local `FetchEvent` type and casts `self` to access `addEventListener`. This is fine because `sw.ts` is compiled by esbuild (type-strips only — no type checking), so TypeScript errors in this file are IDE warnings only and do not block the build.

## CSP (Content-Security-Policy)

CSP is configured in `next.config.ts` via the `headers()` function (not middleware).

### `script-src` must include `'unsafe-inline'`

Next.js injects inline `<script>` tags for hydration data. Without `'unsafe-inline'` in `script-src`, CSP blocks them and the **entire app renders as a blank page** — no console errors in the page itself, only CSP violation messages. A nonce-based approach would be more secure but requires Next.js middleware to inject nonces into every response.

### `connect-src` must include local dev origins

PowerSync runs on a different port (`localhost:8080`) than the Next.js dev server. `'self'` only covers the same origin (same port). Add `http://localhost:* ws://localhost:*` for local development, otherwise PowerSync WebSocket connections are silently blocked.

## UI Patterns

### Inline splash spinner — public routes must dismiss it

The root layout (`src/app/layout.tsx`) renders an inline `#app-splash` spinner that covers the viewport until the app paints. For authenticated routes, `AppShell` dismisses it. For public routes (`(public)/` group — login, landing), there is no `AppShell`, so the public layout (`src/app/(public)/layout.tsx`) must be a `"use client"` component that dismisses the spinner in a `useEffect`. Without this, public pages render behind the opaque spinner overlay and appear blank.

### Base UI Select: always provide children to `SelectValue`

The Select component uses `@base-ui/react` (not Radix). Base UI's `SelectValue` may display the raw `value` prop (e.g. a UUID) instead of the selected item's display text. Always render the label explicitly:

```tsx
<SelectValue placeholder="בחר מחלקה">
  {options.find((o) => o.id === selectedId)?.name ?? "בחר מחלקה"}
</SelectValue>
```

### Toast notifications via Sonner

All user-facing mutations should show a `toast.success()` on completion (from `sonner`). The `<Toaster />` component is in `layout.tsx`, configured for RTL. For form dialogs that call an `onSuccess` callback, the **parent** is responsible for the toast — the form itself just calls the callback.

### CycleContext auto-select and `isLoading` flag

`CycleContext` exposes `isLoading: boolean` that is `true` while the session is still loading OR when cycles exist but the auto-select `useEffect` hasn't fired yet. Pages should return `null` (or a skeleton) while `isLoading` is true to avoid flashing "no access" or "choose a cycle" messages before the cycle state resolves.

The auto-select `useEffect` depends on a stable key of all active cycle IDs (`activeCycles.map(a => a.cycleId).join(",")`) — not just `activeCycles.length`. This ensures the effect re-fires when cycles are swapped out even if the count stays the same (e.g. two old cycles deactivated and two new ones created).

## PowerSync + React Rendering Gotchas (continued)

### `useStatus()` crashes during SSR

The `PowerSyncProvider` renders children **without** a context wrapper during SSR (`db` is `null` on the server). Calling `useStatus()` during SSR throws `Cannot read properties of null (reading 'currentStatus')`. Pages that are the first to load (e.g. `/home`) hit this because they're server-rendered. Pages reached via client navigation (e.g. `/activities`) don't because the context is already mounted.

**Workaround:** don't use `useStatus()` on pages that may be SSR'd. Use a timeout-based grace period instead, or create a wrapper hook that checks `useContext(PowerSyncContext)` before accessing status.

### `hasSynced` does not reflect previously cached data

`useStatus().hasSynced` only becomes `true` after a sync completes **in the current session**. It does NOT reflect data already available in the local SQLite DB from a previous session. `useQuery` returns that cached data immediately, but `hasSynced` stays `false` until `connect()` + sync finishes. Do not use `hasSynced` to gate "has data loaded" — use a timeout or check `data.length > 0` instead.

### Detail page grace period pattern

Detail pages (`/activities/[id]`, `/soldiers/[id]`, `/requests/[id]`) and the home page use a 3-second `timedOut` flag as a hard upper bound before showing "not found" / "no data". Data renders immediately when available — the timeout only gates the error state. A spinner is shown while waiting. The variable is named `timedOut` (not `ready`) to clarify that it represents the timeout expiring, not data being ready.

## Testing

### Unit Tests (Vitest)

Unit tests live in `__tests__/` directories alongside the code they test. Run with `npm test`. Coverage is ~98% line coverage across 408 tests.

Configuration is in `vitest.config.ts`. Tests use `vi.mock()` for Prisma, NextAuth, and other server dependencies. PowerSync hooks are mocked at the module level.

### E2E Tests (Playwright)

81 end-to-end tests across 12 spec files in `e2e/`. They run against the full stack (Next.js + PostgreSQL + PowerSync + Mailhog) via Docker Compose. Locally the suite runs in ~1 minute; CI takes 5–6 minutes due to slower GitHub Actions runners (shared VM, Docker overhead, serial execution).

**Running:** `npm run e2e` (or `npm run e2e:ui` for the Playwright UI). The Docker Compose stack must be running with the e2e overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d
```

This creates a separate `tironet_test` database so e2e tests don't touch the dev DB. PowerSync is reconfigured to sync from `tironet_test`.

**Architecture:**
- `playwright.config.ts` defines 5 projects: `setup` (logs in 3 users via Mailhog), `admin-warmup` (pre-compiles admin routes), then `admin-tests`, `commander-tests`, `squad-tests` each using saved `storageState`
- `e2e/admin-warmup.ts` visits all admin pages and API endpoints before admin tests run, preventing Turbopack compilation-induced hangs (see gotcha #7)
- `e2e/global-setup.ts` seeds the test DB (Prisma), authenticates users via the magic link flow (Mailhog API), and saves auth state to `e2e/.auth/*.json`
- `e2e/global-teardown.ts` truncates all tables after the run

**Key gotchas for writing e2e tests:**

1. **Test isolation with `fullyParallel: true`** — Admin CRUD tests must NOT modify seeded data (cycles, activity types). Each test should create its own temporary data, operate on it, and leave seeded data untouched. Modifying seeded data (e.g. deactivating "Test Cycle 2026") breaks all PowerSync-dependent tests running in parallel.

2. **PowerSync sync timing** — Fresh browser contexts need 30–60 seconds for a full sync. Use `test.setTimeout(90000)` on describe blocks for PowerSync pages, and `{ timeout: 60000 }` on the first assertion that depends on synced data.

3. **Hebrew name display convention** — The UI displays soldiers as `familyName givenName` (e.g. "Cohen Avi", not "Avi Cohen"). All test assertions must use this order.

4. **Playwright strict mode** — Selectors matching multiple elements throw errors. Common fixes:
   - `.first()` when multiple matches are acceptable
   - `{ exact: true }` to avoid substring matches (e.g. `getByRole("button", { name: "טיוטה", exact: true })`)
   - Scope to `page.getByRole("main")` to avoid matching sidebar text (e.g. "Squad Commander" matching `getByText("Squad C")`)

5. **Sync scopes by `cycle_id`, not `squad_id`** — Squad commanders see ALL soldiers in their cycle, not just their squad. This is intentional — the sync stream filters by `cycle_id`. Don't write tests asserting squad commanders can't see other squads' soldiers.

6. **Mailhog quoted-printable encoding** — Email bodies use `=3D` for `=` and soft line breaks (`=\r\n`). The `extractVerificationUrl` helper in `e2e/helpers/mailhog.ts` handles decoding.

7. **Turbopack compilation blocking** — Turbopack compiles routes lazily and blocks ALL HTTP requests while compiling any single route. This causes admin tests to hang when routes haven't been compiled yet. The `admin-warmup` project pre-compiles all admin routes before tests run. Admin tests also use `fullyParallel: false` to avoid compilation storms from concurrent navigations. After modifying source files locally, the first `npm run e2e` triggers recompilation mid-test, which causes Fast Refresh and resets React component state. **Workaround:** run `npm run e2e` twice — the first run warms the server, the second reuses it and passes cleanly. In CI this is not an issue because there are no concurrent file edits.

8. **Cross-role tests must verify server-side sync before closing contexts** — Tests that create data in one browser context (e.g. squad commander) and read it in another (e.g. platoon commander) must NOT use `waitForTimeout()` to wait for the PowerSync connector to upload. The upload may not complete before the context is closed, losing the data. Instead, poll the server API to verify the data exists:

   ```typescript
   // Poll until the request exists on the server (connector has uploaded it)
   await waitForRequestOnServer(page, requestId);
   // Only then close the context
   await page.close();
   await context.close();
   ```

   This is especially important in CI where slower execution makes fixed timeouts unreliable.

9. **Profile test interference with admin assertions** — The profile edit test (`e2e/profile.spec.ts`) temporarily changes the admin user's display name. Admin tests that assert on the admin user should use the email (`admin-e2e@test.com`) rather than the display name to avoid flaky failures from parallel execution.

## Environment Variable Naming

- Variables used inside the PowerSync Docker container must be prefixed `PS_` to work with the `!env` tag in `powersync.config.yaml`
- `POWERSYNC_JWT_SECRET` is the raw secret (used by Next.js to sign tokens) — no `PS_` prefix needed since Next.js reads it directly
- `PS_JWT_SECRET_B64URL` is its base64url encoding (used by PowerSync to verify tokens via JWKS) — needs `PS_` prefix
- `PS_JWT_AUDIENCE` is the allowed JWT audience value (must match `NEXT_PUBLIC_POWERSYNC_URL`)
