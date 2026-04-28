# Tironet — Claude Context

This file captures architectural decisions, constraints, and gotchas for Claude when working on this codebase.

## Definitions

[`docs/DEFINITIONS.md`](docs/DEFINITIONS.md) contains the authoritative definitions for terms used throughout the application (activity statuses, request statuses, role access). Always consult this file when implementing features that involve these concepts, and update it when definitions change.

## Definition of Done

Before considering any issue or task complete, always:

1. **Tests** – Evaluate whether the changes require new or updated unit or e2e tests. If so, write them. Do not close out a task without test coverage for new behavior.

2. **CLAUDE.md** – Check if the changes affect how this project should be worked on (setup steps, conventions, architecture decisions). If so, update this file.

3. **README.md** – Check if the changes affect user-facing behavior, configuration, installation, or usage. If so, update the README to reflect the current state.

4. **Schema changes** – When modifying the Prisma schema, always run `npx prisma migrate dev --name <name>` to create and apply the migration. When modifying PowerSync schemas (`sync-config.yaml`, `schema.ts`), restart the local PowerSync container with `docker compose restart powersync` so it picks up the new config. When summarizing changes to the user, remind them that the sync config needs to be deployed (PowerSync Cloud or Docker) for production.

## Tech Stack Summary

- **Next.js 16** App Router, TypeScript, Tailwind CSS v4
- **NextAuth v5** JWT strategy, Google OAuth + email magic link + SMS OTP (Twilio Verify)
- **PostgreSQL** via Prisma ORM
- **PowerSync** (`@powersync/web` + `@powersync/react`) for offline-first sync — Sync Streams edition 3
- **PWA** via `@serwist/turbopack` (service worker compiled via esbuild route handler)

## PowerSync Architecture

### Why Sync Streams (not Sync Rules)

We use **PowerSync Sync Streams** (`edition: 3`, recommended for all new apps as of 2026) rather than the legacy Sync Rules YAML format. Sync Streams supports `JOIN`, subqueries, and CTEs — avoiding the need to denormalize foreign keys into every table just for sync scoping.

Config lives in [`src/lib/powersync/sync-config.yaml`](src/lib/powersync/sync-config.yaml), mounted into the PowerSync Docker container. The main config is [`powersync.config.yaml`](powersync.config.yaml).

### JWT claims for sync scoping

The `/api/powersync/token` endpoint signs a JWT with four custom claims resolved from the user's **active** `UserCycleAssignment` rows. Claims are **truthful** — they represent the user's actual role assignments, not pre-expanded scopes. Expansion into visible units is handled by global CTEs in the sync config.

| Claim | Type | Meaning |
|---|---|---|
| `cycle_ids` | `string[]` | All active cycles the user is assigned to |
| `squad_ids` | `string[]` | Squads where user is `squad_commander` |
| `platoon_ids` | `string[]` | Platoons where user is `platoon_commander` (NOT pre-expanded) |
| `company_ids` | `string[]` | Companies where user is `company_commander`, `instructor`, `company_medic`, or `hardship_coordinator` |

**Inactive cycle filtering:** `resolvePowerSyncClaims()` in `auth.ts` filters out assignments where `cycle.isActive === false` before building claims. This prevents stale roles (e.g. a squad_commander assignment in a deactivated cycle) from polluting the sync scope.

Sync streams use `auth.parameter('key')` to read claims, and global CTEs to expand them. No client-side subscription parameters are needed — all streams use `auto_subscribe: true`.

### Global CTEs for scope expansion

The sync config defines two global CTEs that expand raw role claims into the full set of visible units:

- **`visible_squad_ids`** — all squads the user can see (direct squad assignments + squads in their platoons + squads in their companies). Used for soldier-level and request-level scoping.
- **`visible_platoon_ids`** — all platoons the user can see (platoon of their squad + direct platoon assignments + platoons in their companies). Used for activity/structure/report-level scoping.

```yaml
with:
  visible_squad_ids: >
    SELECT id FROM squads
    WHERE id IN auth.parameter('squad_ids')
    OR platoon_id IN auth.parameter('platoon_ids')
    OR platoon_id IN (SELECT id FROM platoons WHERE company_id IN auth.parameter('company_ids'))

  visible_platoon_ids: >
    SELECT id FROM platoons
    WHERE id IN (SELECT platoon_id FROM squads WHERE id IN auth.parameter('squad_ids'))
    OR id IN auth.parameter('platoon_ids')
    OR company_id IN auth.parameter('company_ids')
```

Streams then use `WHERE squad_id IN visible_squad_ids` or `WHERE platoon_id IN visible_platoon_ids`. This means squad commanders see only their squad's soldiers and requests, but the full platoon's activities and structure.

### Sync stream query patterns for `auth.parameter()`

`IN auth.parameter('key')` works correctly when the filtered column is on the **primary (FROM) table**. When the filtered column is on a **joined table** (not the primary table), use a **subquery** instead. The `json_each` JOIN pattern (e.g. `JOIN json_each(auth.parameter('platoon_ids')) AS p ON a.platoon_id = p.value`) appears valid per the docs but causes PowerSync to key buckets incorrectly (by the joined table's row ID instead of the parameter value), resulting in all rows being processed as REMOVE operations and 0 rows in the local DB.

**CTE limitations (PowerSync v1.20.x):**
- Global CTEs require edition 3 (which we use)
- Each CTE must be a single `SELECT` — no `UNION`
- Only inner `JOIN` is supported in CTEs (no `LEFT JOIN`)
- CTEs cannot reference other CTEs — each must be self-contained
- Use `OR` + subqueries to combine multiple scope conditions in a single `SELECT`

**Debugging tip:** if a stream appears in `ps_buckets` with non-zero `count_at_last` but the actual table is empty and `ps_oplog` is also empty after a full sync (`hasSynced: true`), the rows were received as REMOVE operations — likely a bucket keying mismatch from the wrong query pattern.

### Local Docker setup quirks

- **`sslmode: disable`** must be set as a top-level field in `powersync.config.yaml` under the connection — NOT as a `?sslmode=disable` URL parameter. The pgwire library used by PowerSync ignores URL-embedded SSL params.
- **MongoDB must run as a replica set** (`--replSet rs0`). Standalone MongoDB is not supported by PowerSync. After first launch, `rs.initiate()` must be run once manually (see README).
- **PostgreSQL publication** must be created once: `CREATE PUBLICATION powersync FOR ALL TABLES`. Required for WAL logical replication.
- **Both Docker Compose and Next.js read `.env`** — a single `.env` file is sufficient for local development.
- **`docker compose restart`** does not re-read `.env`. Use `docker compose up -d` to pick up env changes.
- **`docker-compose.yml` `environment:` section is the source of truth** for what env vars reach the container. Variables in `.env` are only injected if explicitly listed there — `!env` in `powersync.config.yaml` reads from the container environment, not directly from `.env`.

### JWT audience configuration

The PowerSync service requires a valid `aud` claim in every JWT. The allowed values are configured via `client_auth.audience` (singular) in `powersync.config.yaml` — **not** `audiences` (plural). Source confirmed from `compound-config-collector.js`: `baseConfig.client_auth?.audience ?? []`.

The `aud` value in tokens must match `NEXT_PUBLIC_POWERSYNC_URL` (e.g. `http://localhost:8080` in dev). Both the token endpoint and `powersync.config.yaml` must agree.

### VFS: must use OPFSCoopSyncVFS (not IDBBatchAtomicVFS)

The default wa-sqlite VFS (`IDBBatchAtomicVFS`) causes iOS Safari to crash with "A problem repeatedly occurred". Root cause: IDBBatchAtomicVFS triggers stack overflows and exhausts WebKit's WASM gigacage memory region (WebKit bug 269937). iOS's JetSam daemon kills the WebContent process, and two rapid kills trigger the crash screen.

**Fix:** `database.ts` explicitly sets `vfs: WASQLiteVFS.OPFSCoopSyncVFS`, which uses the Origin Private File System API instead of IndexedDB. This is faster and avoids the crash path entirely.

**Caveat:** OPFS is not available in Safari Private Browsing mode. If incognito support is needed, add a runtime check and fall back to IDBBatchAtomicVFS.

### OPFS corruption auto-recovery (#148)

OPFS SQLite databases can become corrupted when iOS kills the PWA's WebContent process mid-write (JetSam, memory pressure). The error is `CORRUPT: database disk image is malformed` in PowerSync's `downloadError`. When this happens, sync cannot complete — reads from uncorrupted parts still work, but no new data arrives and `connected` stays false.

**Auto-recovery:** `PowerSyncProvider` watches for corruption via `registerListener({ statusChanged })`. When detected:
1. Sets `dbCorrupt` state → shows a fullscreen spinner overlay ("מאפס נתונים מקומיים וטוען מחדש...")
2. `clearLocalDatabase()` disconnects PowerSync, deletes the OPFS files (`tironet.db`, `-journal`, `-wal`) directly via `navigator.storage.getDirectory()`, and reloads the page
3. On reload, PowerSync creates a fresh DB and syncs from scratch

`disconnectAndClear()` (PowerSync's built-in) cannot be used because it executes SQL internally, which fails on the corrupt DB. The OPFS files must be deleted directly.

**Manual fallback:** The support page has a "clear and resync" button (`ClearAndResyncSection`) that calls the same `clearLocalDatabase()` utility. This is available regardless of whether corruption is detected — useful for any sync issue.

**Key files:**
- `src/lib/powersync/clear-local-db.ts` — OPFS delete + reload utility
- `src/components/providers/PowerSyncProvider.tsx` — `isCorruptError()` detection + auto-recovery effect

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

### `ActivityDetail` uses `useState(initialData)` — merge new soldiers, never remount

`ActivityDetail` initializes its internal state with `useState(initialData)` and uses a `useEffect` to merge new soldiers from prop changes into the existing `data` and `reports` state. This handles soldiers arriving incrementally during PowerSync sync without remounting the component (which would discard in-progress edits).

The component is keyed on **squad IDs only** — not on soldier presence or count:

```tsx
<ActivityDetail
  key={data.squads.map(s => s.id).join(",")}
  initialData={data}
/>
```

**Do NOT** add soldier presence or count to the key — on slow networks, soldiers trickle in during sync and a key change would remount the component, discarding unsaved report edits (this was the root cause of the "frozen reports" bug #98).

The merge `useEffect` in `ActivityDetail` adds new soldiers to each squad and initializes their reports with empty values. It never overwrites existing entries, so in-progress edits are preserved.

If you ever add another `useState(initialData)` component fed by chained `useQuery` params, apply the same merge-via-effect pattern instead of relying on key changes.

### `ActivityDetail` performance patterns

**Batch writes with `writeTransaction`:** Bulk operations (`handleBulkUpdate`, `handleImportReports`) wrap all `db.execute()` calls in a single `db.writeTransaction()`. This sends one round-trip to the SQLite web worker instead of N sequential awaits. Without this, "update all to passed" with 30 soldiers takes seconds; with it, near-instant.

**No disabled/saving state on report rows:** Report edits are optimistic — `handleReportChange` updates local state synchronously, then `saveReport` writes to SQLite in the background. The row is never greyed out or disabled during the write. Since writes are local SQLite (not network), they can't fail in a meaningful way that the user needs to wait for.

**`ReportRow` is memoized with `React.memo`:** Every call to `setReports` re-renders `ActivityDetail`, but `memo` prevents unchanged `ReportRow` components from re-rendering. For this to work, the `report` prop must be referentially stable — use the constant `EMPTY_REPORT` (not `{ ...EMPTY_REPORT }` which creates a new object each render).

**Debounce cleanup:** `ActivityDetail` stores `setTimeout` handles in a `debounceRefs` Map for score/note auto-save. A `useEffect` cleanup clears all pending timeouts on unmount to prevent stale callbacks firing against unmounted state. If you add more debounced refs, follow the same cleanup pattern.

**`reportsRef` for stable callbacks:** `handleReportChange` is memoized (so `ReportRow`'s `memo` works) but needs current report state. A `reportsRef` is updated on every render (`reportsRef.current = reports`). The handler reads from the ref — not from the `setReports` updater (React 18 batches updaters, so values assigned inside may not be available outside) and not from a `reports` dependency (which would break memoization). Debounced callbacks also re-read from the ref at fire time to get the latest id.

**Side effects outside state updaters:** `saveReport` is called **outside** `setReports`, not inside the updater. React Strict Mode (enabled by default in Next.js dev) double-invokes state updater functions. If `saveReport` (which calls `db.execute(INSERT...)`) runs inside the updater, each report save creates two rows. This was the root cause of duplicate POSTs in dev.

### Activity detail page uses activity-cycle assignment, not global context

The activity detail page (`/activities/[id]/page.tsx`) resolves the user's role and squad from the assignment matching `activity.cycle_id`, not from `selectedAssignment` in `CycleContext`. This handles users with assignments in multiple cycles correctly (e.g. squad_commander in a past cycle + platoon_commander in the current one).

## Offline-First Writes via PowerSync

### Pattern: write to local DB, let the connector sync

All user mutations that need to work offline must write to the local PowerSync SQLite DB via `db.execute()` rather than calling the API directly. PowerSync queues the write as a CRUD operation and the connector uploads it when connectivity is restored.

```typescript
// In a component:
const db = usePowerSync(); // from @powersync/react

// UPDATE existing row — only SET the changed field(s) to avoid overwriting
// concurrent edits from other clients.
await db.execute(
  "UPDATE activity_reports SET grade1 = ?, activity_id = ?, soldier_id = ? WHERE id = ?",
  [grade1, activityId, soldierId, id]
);

// INSERT new row — use deterministicId() so all clients generate the same
// UUID for the same (activityId, soldierId) pair. This prevents orphaned
// CRUD ops when sync replaces one client's row with another's.
const newId = await deterministicId(activityId, soldierId);
await db.execute(
  "INSERT INTO activity_reports (id, activity_id, soldier_id, result, ...) VALUES (?, ?, ?, ?, ...)",
  [newId, activityId, soldierId, result, ...]
);
```

Writes are **instant and optimistic** — no network round-trip, no loading state needed. `useQuery` on the same table reacts immediately. Update local component state manually when `useState` holds a derived copy (e.g. `reports` Map in `ActivityDetail`).

### Concurrent activity report editing

Multiple commanders (e.g. squad commander + platoon sergeant) can edit the same soldier's report simultaneously. The design prevents lost updates at every layer:

**1. Deterministic IDs (`src/lib/deterministic-id.ts`):** `deterministicId(activityId, soldierId)` generates a UUID v5-style id from the composite key via SHA-1. Both clients produce the **same id** for the same soldier, so PowerSync treats their writes as operations on the same row. Without this, each client generates a random UUID and sync replaces one with the other, orphaning pending CRUD ops.

**2. Field-specific UPDATEs:** `saveReport` with a `changedField` param UPDATEs only that column (`SET grade1 = ?`), not all columns. PowerSync's `opData` then contains only the changed field, and the server PATCH applies only that field — so commander A setting grade1 doesn't overwrite commander B's grade2.

**3. Upsert in `saveReport`:** Before writing, `saveReport` queries local SQLite to check if the row exists (`SELECT id ... WHERE id = ?`). If yes → UPDATE; if no → INSERT. This handles the case where the debounced grade save fires before the INSERT's `setReports` has updated React state (the `report.id` in the closure is null, but the row exists in SQLite).

**4. Server-side merge on POST upsert:** The POST endpoint's `update` clause uses `grade1 ?? undefined` (not `?? null`). Prisma treats `undefined` as "don't touch", so a PUT with `grade1: undefined` won't overwrite an existing grade1 value.

**5. Composite key on PATCH:** The connector includes `activity_id` and `soldier_id` in the UPDATE SET clause so they appear in `opData`. The PATCH API looks up by composite key first (`activityId_soldierId`), falling back to the URL id. This resolves the correct server-side row even if the client's local id was orphaned.

**6. Idempotent DELETE:** The DELETE endpoint returns 200 (not 404) when the id doesn't exist, since orphaned client UUIDs are expected in concurrent scenarios.

**Key files:**
- `src/lib/deterministic-id.ts` — SHA-1 based UUID generation
- `src/components/activities/ActivityDetail.tsx` — `saveReport`, `handleReportChange`, `handleBulkUpdate`
- `src/lib/powersync/connector.ts` — composite key enrichment on PATCH
- `src/app/api/activity-reports/route.ts` — `mergeGrades` on upsert
- `src/app/api/activity-reports/[id]/route.ts` — composite key lookup on PATCH, idempotent DELETE

### Connector: `uploadData` uploads the CRUD queue

`src/lib/powersync/connector.ts` uploads queued writes via `uploadData()`. Key rules:

1. **Network errors (`TypeError: Failed to fetch`)** — do not call `transaction.complete()`. PowerSync retries automatically when connectivity is restored.
2. **4xx client errors (bad data, permission denied)** — call `transaction.complete()` to drain the failed operation. Retrying will never succeed and would block all subsequent uploads. The error is logged with a warning.
3. **5xx server errors** — do not call `transaction.complete()`. PowerSync retries automatically.
4. **PowerSync CRUD `opData` uses snake_case** (matching the local schema column names). Transform to camelCase before calling the API. Example: `opData.activity_id` → `activityId`.
5. **PUT operations must pass the client-generated `id`** to the server so the server creates the record with the same UUID the local DB already has. Without this, the server generates a new UUID and PowerSync syncs back a duplicate record with a mismatched ID.
6. **Activity report PATCHes include composite key** — the connector reads `activity_id` and `soldier_id` from `opData` (included in the UPDATE SET clause) and sends them as `activityId`/`soldierId` in the PATCH body. The server uses these to look up by composite key first, falling back to the URL id.

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

**Do not** call `db.disconnect()` in the `useEffect` cleanup. The DB is a module-level singleton — disconnecting during cleanup (HMR, StrictMode, or Safari tab suspension/resume) leaves OPFS file handles in a broken state, causing the next `init()` to deadlock on `waitForReady()`. The cleanup should only remove listeners and clear timers, not disconnect the DB.

If `init()` itself fails (OPFS corruption, quota exceeded, Safari Private Browsing), `PowerSyncProvider` shows a persistent banner ("מצב לא מקוון אינו זמין") so users know offline mode is unavailable. This is distinguished from `connect()` failure (offline, expected) by checking `!localDb.connected` after the catch.

### Token fetch throttling and auth error handling

PowerSync retries `fetchCredentials()` rapidly when the sync stream drops. Without throttling, this fires dozens of failing `/api/powersync/token` fetches per second while offline. `connector.ts` implements **exponential backoff** (2s → 4s → 8s → ... capped at 30s) that resets on success.

**Auth errors (401/403)** are distinguished from network errors. When the token endpoint returns 401 or 403 (session expired or revoked), the connector clears its cached token and throws a distinguishable `"Authentication expired (${status})"` error. This allows callers to prompt re-login instead of silently retrying with dead credentials.

### Offline indicator

`useOnlineStatus()` in `src/hooks/useOnlineStatus.ts` uses `navigator.onLine` exclusively to determine device connectivity. The banner means "your device has no network" — it does **not** track PowerSync sync status. If the device is online but PowerSync can't connect (captive portal, server outage), data is still read/written locally and resyncs automatically when the issue resolves.

`hasPendingUploads` is true when `status.dataFlowStatus.uploadError` is set (failed upload attempt while offline) — this drives the "שינויים ממתינים לסנכרון" pill in `OfflineBanner`.

**Debounce:** online → offline transitions are debounced by 2 seconds so brief network blips don't flash the banner. Offline → online is instant (no delay).

**Do not** add PowerSync `status.connected` checks to the banner logic — this was tried previously and caused the banner to flash during hydration (#81) because PowerSync takes seconds to establish its WebSocket, during which `status.connected` is false even though the device is online. Page-level `useSyncReady()` handles the "can't load data" case separately.

### Sync status indicator (#150)

A colored dot next to the support icon (LifeBuoy) in both AppShell (mobile) and Sidebar (desktop) shows PowerSync sync health. Tapping the dot or the icon navigates to `/support` where a detailed sync status section shows the current state and last sync time.

**States (`useSyncStatus` hook in `src/hooks/useSyncStatus.ts`):**

| State | Color | Condition |
|---|---|---|
| `initializing` | Grey | Haven't connected to PowerSync yet this session |
| `synced` | Green | Connected and not downloading |
| `syncing` | Blue (pulse) | Connected and actively downloading |
| `stale` | Yellow | Was connected this session, now disconnected |
| `error` | Red | `downloadError` contains "CORRUPT" (database corruption only) |

**No grace period — signal-based:** The hook tracks `hasConnectedThisSession` (a ref, resets on page load). Before first connection, the state is always "initializing" (grey). This is simpler than the previous timer-based grace period and guarantees the toolbar dot and support page always agree — both use the same ref. On app open, users see grey for 1-3s until PowerSync's WebSocket connects, then green.

**2s connected → disconnected debounce:** After the first connection, brief WebSocket drops during reconnection don't flash yellow. Only disconnects lasting >2s are shown. The debounce is inactive before the first connection (always grey).

**Error vs stale distinction:** Connection failures (server unreachable, network issues) are **stale** (yellow), not error. **Error** (red) is reserved for OPFS database corruption, which triggers the auto-recovery flow. This distinction is important — yellow means "check your connection", red means "data is broken and being reset".

**SSR safety:** Uses `useSafeStatus()` (not `useStatus()`). `SyncStatusDot` is a `"use client"` component.

**Support page sync section:** `SyncStatusSection` on the support page shows status label + last synced time. When state is error (corruption), a red callout recommends reset. Otherwise, reset is collapsed behind a text link to reduce visual noise.

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

### One role per user per cycle

`UserCycleAssignment` has a `@@unique([userId, cycleId])` constraint — a user can only have one role in each cycle. The admin assignment endpoint returns a 409 with a Hebrew message if a duplicate is attempted. This also prevents sync claim pollution (e.g. a user getting both squad-level and platoon-level claims in the same cycle).

## Requests (בקשות) Workflow

### Request types

Three types: `leave` (יציאה), `medical` (רפואה), `hardship` (ת"ש). Each has type-specific fields defined in the Prisma schema and PowerSync local schema.

### Medical appointments — JSON column

Medical requests store appointments as a JSON array in `medical_appointments` (Prisma `Json?`, PowerSync `column.text`, SQLite text). Each appointment has `{ id, date, place, type }`. The `id` is a client-generated UUID for stable React keys.

**Key patterns:**
- **Prisma null handling:** Use `Prisma.DbNull` (not `null`) when setting the column to SQL NULL via Prisma.
- **PowerSync connector:** The connector JSON-parses `medical_appointments` from the SQLite text column before sending to the API (`JSON.parse()`).
- **Soldiers page "active" query:** Uses SQLite `json_each()` + `json_extract()` to check if any appointment date is in the future.
- **Shared utilities:** `src/lib/requests/medical-appointments.ts` exports `parseMedicalAppointments()`, `hasUpcomingAppointment()`, and `formatAppointment()`. Use these everywhere instead of inline parsing.
- **Detail page editing:** Appointments can be added/edited/removed on the request detail page by users with the assigned role. Edits are written directly to local SQLite via `db.execute()`.
- **"Open" logic:** A medical request is considered active (soldiers page badge) if **any** appointment date or sick day date is in the future.

### Sick days — JSON column

Medical requests store sick days as a JSON array in `sick_days` (Prisma `Json?`, PowerSync `column.text`, SQLite text). Each entry has `{ id, date }` where `date` is `YYYY-MM-DD`. The `id` is a client-generated UUID for stable React keys.

- **Shared utilities:** `src/lib/requests/sick-days.ts` exports `parseSickDays()`, `hasUpcomingSickDay()`, `formatSickDay()`, and `expandSickDayRange()`. Use these everywhere instead of inline parsing.
- **Range input:** The create and detail page UIs let users enter a from/to date range, which `expandSickDayRange()` expands into individual `SickDay` entries. An empty "to" field means a single day.
- **Active logic:** `isRequestActive()` checks both appointments and sick days — a medical request is active if either has a future date.
- **All patterns** (Prisma `DbNull`, connector JSON parsing, `json_each()` in SQLite queries, detail page editing) follow the same patterns as medical appointments above.

### Workflow state machine

Requests use a `status` + `assignedRole` pair to track progress. `assignedRole` is nullable — `null` means the workflow is complete (terminal state).

**Creation routing:**
- Squad commander creates → assigned to `platoon_commander`
- Platoon commander creates → assigned to `platoon_commander` (self-assigned)
- Admin creates → assigned to `platoon_commander`

**Approval chain (all request types):**
```
squad_commander creates → platoon_commander (approve/deny)
  → if approved: squad_commander (acknowledge) → done (assignedRole = null)
  → if denied: squad_commander (acknowledge) → done
```

The company commander is **not** part of the approval workflow. The platoon commander is the final approver for all request types.

**Key implementation detail:** the `acknowledge` action passes the decision down the chain without changing the status. Only approve/deny change the status.

### Audit trail (`RequestAction`)

Every workflow event (create, approve, deny, acknowledge, note) is recorded in the `request_actions` table. Each action stores `userId`, `action`, optional `note`, `userName` (denormalized for offline display), and `created_at`. The detail page renders a chronological timeline of all actions under "מהלך הטיפול".

Approve and deny actions open a dialog with an optional note field. The note is stored on the `RequestAction` row, not on the `Request` itself.

**Standalone notes:** Users can add a "note" action at any time via the "הוסף הערה" link. Notes have no effect on the workflow (no status or assignedRole change). Users can also edit the note text on their own actions as long as the request is not completed (`assignedRole !== null`). Edits are written to local SQLite via `db.execute("UPDATE request_actions SET note = ? WHERE id = ?", ...)` and synced by the connector via `PATCH /api/request-actions/[id]`.

The `userName` column is denormalized from the user's `familyName givenName` at write time so the timeline renders correctly offline (the `users` table is not synced via PowerSync).

### Authorization on request mutations

- **DELETE `/api/requests/[id]`** — role-based: the request creator OR any role with edit permission (`canEditRequest()` from `src/lib/requests/permissions.ts`) can delete. Only open requests (`assignedRole !== null`) can be deleted.
- **POST `/api/request-actions`** calls `getRequestScope()` and verifies the request's soldier is in the user's scope before creating an audit entry.
- **PATCH `/api/requests/[id]` field edits** — role-based via `canEditRequest()`, OR the currently assigned role can edit. This replaces the previous inline permission checks.
- **PATCH `/api/requests/[id]` (connector path)** validates that the `(status, assignedRole)` transition is reachable via a valid workflow action using `isValidTransition()` from `src/lib/requests/workflow.ts`. This prevents the PowerSync connector from bypassing the state machine (e.g. jumping directly from open to approved).

### Request edit/delete permissions (`src/lib/requests/permissions.ts`)

`canEditRequest(role, requestType)` determines who can edit request fields (role-based, not workflow-based):
- **Platoon commanders, platoon sergeants, company commanders, deputy company commanders** — all request types
- **Company medic** — medical requests only
- **Hardship coordinator** — hardship requests only
- **Squad commanders, instructors** — no edit access

`canDeleteRequest(role, requestType, assignedRole)` uses the same role rules but additionally requires `assignedRole !== null` (open requests only).

### Request detail page — modal edit + separate sections

The request detail page uses three patterns for editing:
1. **Modal edit dialog** — core fields per type (description, leave dates/place/transportation, medical urgent/paramedicDate, hardship urgent/specialConditions). Uses `EditLeaveRequestForm`, `EditMedicalRequestForm`, or `EditHardshipRequestForm` in a `Dialog`.
2. **Inline section editing** — medical appointments (`MedicalAppointmentsSection`) and sick days (`SickDaysSection`) are extracted components with their own edit state, displayed inline on the detail page.
3. **Action log** — note editing and adding notes remain inline on the detail page.

The edit button appears in the header card alongside the status badge. The delete button (with confirmation dialog) also appears in the header for open requests.

### Offline writes

Request creation and workflow actions (approve/deny/acknowledge) write to the local PowerSync SQLite DB via `db.execute()`. Each workflow action writes **two rows**: an UPDATE to `requests` (status/assignedRole) and an INSERT to `request_actions` (audit entry). The connector uploads them separately — the request UPDATE via PATCH to `/api/requests/[id]` and the action INSERT via POST to `/api/request-actions`. The server-side PATCH handler also creates a `RequestAction` when it receives an explicit `action` field (online path), but the connector does NOT pass `action` in the PATCH body, avoiding duplicates.

### Request scoping (`getRequestScope`)

`src/lib/api/request-scope.ts` provides `getRequestScope(cycleId)` which resolves the user's role, permissions (`canCreate`), and `soldierIds` they can access for a given cycle. This is used by both the list and detail API routes. Admin users have `canCreate: true` and see all soldiers.

### List page filtering

The requests list page (`/requests`) has three tabs:
- **Pending** (`ממתינות`): requests where `status === "open"` (in progress through the approval chain). Sorted with "assigned to me" first.
- **Active** (`פעילות`): approved requests that are currently relevant, defined per type:
  - **Leave**: `departureAt >= today` OR `returnAt >= today` (upcoming or currently on leave)
  - **Medical**: any appointment in `medicalAppointments` JSON array has `date >= today`
  - Hardship requests are **not** included in "active" — they have no date criteria and are tracked separately on the soldiers page.
  - Sorted by soonest relevant date first (departure date for leave, next appointment for medical).
- **Requires my action** (`דורשות טיפולי`): requests where `assignedRole !== null && canActOnRequest(userRole, assignedRole)` — cross-cuts open and active statuses

Denied requests pending acknowledgement (`status === "denied"`, `assignedRole !== null`) appear **only** in the "requires my action" tab — not in "pending" or "active". Completed denied requests (`assignedRole === null`) do not appear in any tab.

### Soldiers page "active requests" filter

The soldiers page has two request-related filter pills:

- **"בקשות פתוחות"** — soldiers with any open request (in progress or active leave/medical). A soldier passes if `openRequestCount > 0` (in-progress requests) **or** `approvedRequests.length > 0` (active approved leave/medical from `OPEN_REQUESTS_QUERY`).
- **"ת״ש"** — soldiers with an approved hardship request. Uses a separate `HARDSHIP_REQUESTS_QUERY`. Shows the `RequestTypeIcon` with urgent overlay when `specialConditions` or `urgent` is set.

Both filters add entries to the `approvedRequests` array on `SoldierSummary`, so hardship icons appear on soldier cards alongside leave/medical icons.

### Soldier detail page — full request history

The soldier detail page (`/soldiers/[id]`) shows **all** requests for the soldier in the current cycle, including completed denials and fully acknowledged approvals. This gives a complete picture of the soldier's request history. Approved requests that are currently active (per the definitions in `docs/DEFINITIONS.md`) show a green "פעילה" label next to the status badge.

### Shared request status utilities (`src/lib/requests/active.ts`)

`src/lib/requests/active.ts` exports three functions — do not duplicate this logic inline:

- **`isRequestActive(r, today?)`** — approved + leave with future dates or medical with future appointments. Hardship requests are **not** considered active (they have no date criteria and are tracked separately on the soldiers page).
- **`isRequestOpen(r, today?)`** — in progress (`status === 'open'`) OR active. This is the umbrella "open" definition from `docs/DEFINITIONS.md`.
- **`isRequestUrgent(r)`** — medical with `urgent` flag, or hardship with `specialConditions` or `urgent` flag. The urgent *indicator* (red dot on `RequestTypeIcon`) only shows when the request is also open: `isRequestOpen(r) && isRequestUrgent(r)`

### Badge count scoping (`useRequestBadge`)

The request badge (home page callout, sidebar/tab bar dot) counts requests assigned to the user's **effective role** (e.g. `platoon_sergeant` → `platoon_commander`). For squad commanders, the count is further scoped to their own squad via `s.squad_id = ?`.

## Roles and Access Control

### Role hierarchy

| Role | `effectiveRole()` maps to | Rank | Unit Type | Description |
|---|---|---|---|---|
| `company_commander` | (self) | 3 | company | Full access to all data in their company |
| `deputy_company_commander` | `company_commander` | 3 | company | Same permissions as company commander |
| `instructor` | (self) | 3 | company | Activities and activity reports only — no soldiers page, no requests |
| `company_medic` | (self) | 3 | company | Requests (medical only on list page) and request reports only — no activities, no soldiers page |
| `hardship_coordinator` | (self) | 3 | company | Requests (hardship only on list page) and request reports only — no activities, no soldiers page |
| `platoon_commander` | (self) | 2 | platoon | Full access within their platoon |
| `platoon_sergeant` | `platoon_commander` | 2 | platoon | Same permissions as platoon commander |
| `squad_commander` | (self) | 1 | squad | Access to their own squad only |

### `effectiveRole()` — deputy role mapping

`effectiveRole()` maps `deputy_company_commander` → `company_commander` and `platoon_sergeant` → `platoon_commander`. The roles `instructor`, `company_medic`, and `hardship_coordinator` pass through unchanged because they have distinct access patterns that differ from `company_commander`.

### Instructor (`instructor` / מדריך)

- **Unit type:** company — assigned to a company, sees all platoons in that company
- **Activities:** can view, create (single + bulk, including "all platoons" option), edit activity metadata, and edit activity reports for all squads
- **Cannot access:** soldiers page, requests page, request reports
- **Navigation:** sees only Home + Activities + Reports (activity reports section only)
- **Home page:** sees platoon summary cards with soldiers + activities columns only (no requests). Today's activities section is visible. Request callout and active requests callout are hidden.
- **PowerSync claims:** gets `platoon_ids` expanded from company, same as company commanders
- **Scope functions:** `getActivityScope()` returns `role: "instructor"`, `canCreate: true`, `canEditMetadataForPlatoon` checks platoon membership

### Company Medic (`company_medic` / חופ"ל)

- **Unit type:** company — assigned to a company, sees all platoons in that company
- **Requests:** can view all request types but the list page filters to medical only; can add notes and edit request details but **cannot perform workflow actions** (approve/deny/acknowledge) — `getAvailableActions()` returns `[]` since medic doesn't match any `assignedRole`
- **Cannot access:** soldiers page, activities page, activity reports
- **Navigation:** sees only Home + Requests + Reports (request reports section only, forced to medical type)
- **Home page:** sees platoon summary cards with requests column only (no soldiers, activities, or gaps). Today's activities section is hidden. Request callout and active requests callout are visible.
- **Scope functions:** `getRequestScope()` returns `role: "company_medic"`, `canCreate: false`

### Hardship Coordinator (`hardship_coordinator` / מש"קית ת"ש)

- **Unit type:** company — assigned to a company, sees all platoons in that company
- **Requests:** can view all request types but the list page filters to hardship only; can add notes and edit request details but **cannot perform workflow actions** (approve/deny/acknowledge)
- **Cannot access:** soldiers page, activities page, activity reports
- **Navigation:** sees only Home + Requests + Reports (request reports section only, forced to hardship type)
- **Home page:** sees platoon summary cards with requests column only (no soldiers, activities, or gaps). Today's activities section is hidden.
- **Scope functions:** `getRequestScope()` returns `role: "hardship_coordinator"`, `canCreate: true`

### Invitation permissions (`canInviteRole` / `rolesInvitableBy`)

| Inviter | Can invite |
|---|---|
| Company commander (or deputy) | platoon_commander, platoon_sergeant, squad_commander, instructor, company_medic, hardship_coordinator |
| Platoon commander (or sergeant) | squad_commander, platoon_sergeant |
| Squad commander | (nobody) |
| Instructor / medic / hardship | Lower-ranked roles by rank, but not same-rank peers |

Company commanders can invite company-level peer roles (instructor, medic, hardship coordinator) despite sharing the same rank (3). This is an explicit exception in `canInviteRole` and `rolesInvitableBy` — without it, these roles could only be created by admins.

The `isAuthorizedToInvite` function in `POST /api/invitations` additionally verifies that the target unit is within the inviter's command hierarchy (e.g. a company commander can only invite to their own company, its platoons, or its squads).

### Page access guards

Navigation (Sidebar/TabBar) filters out inaccessible pages, but pages also guard against direct URL access:
- `/soldiers` — blocks `instructor`, `company_medic`, and `hardship_coordinator`
- `/activities` — blocks `company_medic` and `hardship_coordinator`
- `/requests` — blocks `instructor`
- `/reports` — conditionally shows activity reports section (hidden for medic) and request reports section (hidden for instructor)

## Home Page Architecture

The home page (`src/app/(app)/home/page.tsx`) is a role-aware dashboard with four sections, each conditionally rendered:

1. **Requests requiring action** — amber callout linking to `/requests?filter=mine`. Hidden for `instructor`.
2. **Active requests today** (`ActiveRequestsCallout`) — shows approved leave/medical requests active *today* (same logic as the morning cron notification: leave where `departureAt <= today AND returnAt >= today`, medical where an appointment date `=== today`). Hidden for `instructor` and `hardship_coordinator`. Filtered to medical only for `company_medic` via `typeFilter` prop.
3. **Today's activities** (`TodayActivities`) — activities scheduled for today with progress bars. Grid layout (2 columns on desktop), capped at 4 with "show more". Hidden for `company_medic`, `hardship_coordinator`, and `instructor`.
4. **Summary cards** — role-dependent:
   - **Squad commander:** single `SquadSummaryCard`
   - **Platoon commander:** `AggregateRow` + grid of `SquadSummaryCard` (2 columns)
   - **Company-level roles** (company commander, deputy, instructor, medic): grid of `PlatoonSummaryCard` (2 columns) — aggregated stats per platoon, not per squad

### Card section visibility

Both `SquadSummaryCard` and `PlatoonSummaryCard` accept an optional `sections` prop (`VisibleSections`) to control which stat columns render. This is used for role-based filtering:
- **Instructor:** soldiers + activities only (no requests column, keeps gaps)
- **Company medic:** requests only (no soldiers, activities, or gaps)
- **All other roles:** all sections visible (default)

### Active request counts use shared utilities client-side

The home page's `REQUESTS_QUERY` fetches individual request rows (not pre-aggregated counts) so the `requestsMap` builder can apply `isRequestActive()` from `src/lib/requests/active.ts`. This keeps the "active" definition in one place — do not duplicate the active logic in SQL.

## API Conventions

- All protected routes call `auth()` from `@/lib/auth/auth` and check `session.user`
- Admin routes use `requireAdmin()` from `@/lib/api/admin-guard`
- Non-admin data access is scoped via `getActivityScope()` (activities), `getRequestScope()` (requests), or `getReportScope()` (reports) which resolve the user's role and unit IDs for a given cycle
- Polymorphic FK: `UserCycleAssignment.unitId` points to `companies`, `platoons`, or `squads` depending on `unitType`. Referential integrity is enforced at the application layer, not by the DB.

### `isAdmin` is for admin routes only — never for scope expansion

The `isAdmin` flag on `User` controls access to **admin pages** (cycle management, activity types, user invitations, etc.) via `requireAdmin()`. It must **never** be used to bypass or expand data scope in scope functions (`getActivityScope`, `getRequestScope`, `getReportScope`) or in API route handlers like `/api/soldiers`.

Admin users access scoped data (activities, soldiers, requests, reports) through their `UserCycleAssignment` like everyone else. An admin without a cycle assignment gets a 403 on scoped endpoints — they use admin pages for system management, not scoped views.

**Do not** add `if (user.isAdmin)` early returns in scope functions or inline scope checks in API routes. This was a prior bug (issue #41) where admins with a platoon_commander assignment saw data from all platoons.

### Soldiers are always viewed by scope

All soldier-facing views (soldiers page, requests page, activity reports) filter soldiers by the user's scope:

- **Squad commanders** see only soldiers in their own squad
- **Platoon commanders** see only soldiers in their platoon's squads
- **Company commanders** see soldiers across all platoons in their company

PowerSync sync streams scope soldiers by `visible_squad_ids` (the global CTE), so squad commanders receive only their own squad's soldiers. Platoon and company commanders receive all soldiers within their visible platoons. Client-side pages may still filter by squad for UI purposes. Server-side API routes use `getRequestScope().soldierIds` which is already correctly scoped.

### Commanders Page (`/users`)

A client-side page for platoon+ commanders to manage subordinate users in their current cycle. Uses `CycleContext` (no cycle selector on the page itself — always shows the currently selected cycle).

**Key files:**
- `src/app/(app)/users/page.tsx` — client component, fetches from `/api/users/hierarchy?cycleId=...`
- `src/components/CommanderUsersPanel.tsx` — user table with edit, invite dialog, and filter pills
- `src/components/users/PendingInvitationsTable.tsx` — shared invitation table (used by both commanders and admin pages)
- `src/types/users.ts` — shared types (`ManagedUser`, `ManagedInvitation`, `UserAssignment`, `UnitStructure`)

**Scope:**
- Platoon commanders see: platoon sergeant + squad commanders in their platoon
- Company commanders (and deputies) see: all platoon/squad-level roles + company-level roles (instructor, medic, hardship coordinator)
- Peer platoon commanders on the same platoon are excluded

**Invite flow — smart existing-user detection:**
`POST /api/invitations` checks if a user with the submitted email/phone already exists:
- **Existing user, no cycle assignment** → creates `UserCycleAssignment` directly (no invitation link needed). Returns `{ assigned: true, userName }`. Profile fields from the form are silently ignored.
- **Existing user, already assigned to this cycle** → returns 409 ("למשתמש זה כבר יש שיבוץ במחזור הנוכחי")
- **No existing user** → creates an `Invitation` with a 7-day token as before

The `InviteUserForm` handles both responses: shows "המשתמש שובץ בהצלחה" for direct assignments, and the copy link / send email / send SMS post-creation screen for invitations. The cycle selector is hidden when only one cycle is available (always the case on the commanders page).

**Filter pills:**
Both the commanders page and admin users page show role and unit filter pills (on separate rows) when there are enough users. Filters are toggle-based (click to activate, click again to deactivate).

### Invitation security

- **Sign-in gate:** The NextAuth `signIn` callback (`isSignInAllowed()` in `auth.ts`) blocks account access for users without a pending invitation, existing cycle assignment, or admin flag. Blocked users are redirected to `/not-authorized`. The PrismaAdapter may still create an orphan `User` record before the callback rejects — this is intentional (the record is inert without an assignment).
- **SMS OTP is additionally gated:** The `sms-otp` credential provider in `auth.ts` requires a pending invitation to create a new user. The `/api/auth/sms/send` endpoint also checks for an existing user or invitation before sending an OTP (with rate limiting).
- **PowerSync token requires assignments:** `/api/powersync/token` returns 403 if the user has no `cycle_ids`. No token is issued to users without cycle assignments.
- **Send endpoints** (`/api/invitations/send-email`, `/api/invitations/send-sms`) verify the requester is the invitation creator or an admin before sending.
- **Tokens are never exposed in API responses.** All endpoints return `inviteUrl` (the full `/invite/{token}` URL) instead of the raw `token`. This applies to the admin list, admin refresh, hierarchy, and pending invitations endpoints.
- **Phone-only invitation acceptance** requires the accepting user to have a matching phone number. Users without a phone set are rejected with `phone_mismatch` (403).

## Calendar (לוח אירועים)

A top-level page (`/calendar`) showing a monthly calendar of activities, leave requests, medical appointments, and sick days. Available to all roles except hardship coordinators — including squad commanders (unlike reports, which are platoon+ only).

### Architecture

- **Page:** `src/app/(app)/calendar/page.tsx` — client component. Fetches from `/api/calendar?cycleId=...`, renders filters + month navigation + calendar grid.
- **API (JSON):** `src/app/api/calendar/route.ts` — uses `getCalendarScope()` for auth/scope.
- **API (PDF):** `src/app/api/calendar/pdf/route.ts` — landscape A4, one month per page.
- **Scope:** `src/lib/api/calendar-scope.ts` — like `getReportScope` but includes `squad_commander` (with `squadId` for filtering requests to their squad's soldiers).
- **Data:** `src/lib/calendar/fetch.ts` — Prisma queries for activities (status=active) and requests (status=approved, type=leave/medical).
- **Event logic:** `src/lib/calendar/events.ts` — types, color palettes, date expansion, filter categories, month bounds.
- **PDF renderer:** `src/lib/calendar/render.ts` — self-contained HTML with inline SVG icons from lucide-react.

### Event types and filter categories

Four internal event types: `activity`, `leave`, `medical_appointment`, `sick_day`. The toolbar exposes three **filter categories** that group these: `activity`, `leave`, `medical` (combines appointments + sick days). This keeps the toolbar compact on mobile.

### Responsive views

- **Mobile** (`md:hidden`): `CalendarMobileView` — compact day cells with colored dots (up to 3 per day). Tapping a day shows an event list below. Events link to their detail pages.
- **Desktop** (`hidden md:block`): `CalendarGrid` with `CalendarDayCell` + `CalendarEventChip` — full event chips with icons and labels. Chips link to detail pages.
- Both views share month navigation (`MonthNav`) and are bounded by min/max event dates.

### Color scheme

- **Multi-platoon users** (company level, "all platoons" selected): events colored by **platoon** using a fixed 8-color palette assigned by sort order.
- **Single-platoon users** or filtered to one platoon: events colored by **event type** (blue=activity, amber=leave, rose=medical, purple=sick day).
- Legend and dots both use `color.hex` (inline style) for consistent rendering in light and dark mode.

### Role access

| Role | Activities | Leave | Medical/Sick | Platoon filter |
|---|---|---|---|---|
| squad_commander | Yes | Yes | Yes | Own platoon (no filter) |
| platoon_commander | Yes | Yes | Yes | Own platoon (no filter) |
| company_commander | Yes | Yes | Yes | All + per-platoon |
| instructor | Yes | No | No | All platoons in company |
| company_medic | No | No | Yes | All platoons in company |
| hardship_coordinator | No access | | | |

### Safari grid-cols-7 workaround

`grid-cols-7` (Tailwind v4) doesn't render correctly in Safari mobile — the grid collapses to a single column. Both `CalendarMobileView` and `CalendarGrid` use inline `style={{ gridTemplateColumns: "repeat(7, 1fr)" }}` instead.

### Key files
- `src/lib/calendar/events.ts` — types, colors, `buildCalendarEvents()`, `expandLeaveDates()`, filter category logic, `getMonthBounds()`
- `src/lib/calendar/fetch.ts` — `fetchCalendarData()` (Prisma)
- `src/lib/calendar/render.ts` — `renderCalendarHtml()` (PDF)
- `src/lib/api/calendar-scope.ts` — `getCalendarScope()`
- `src/components/reports/calendar/` — UI components (CalendarGrid, CalendarMobileView, CalendarEventChip, CalendarDayCell, CalendarToolbar, CalendarLegend, MonthNav)

## Physical Training Report (מעקב כשירות גופנית)

A Google Sheets export that produces a weekly training attendance grid per platoon, matching the IDF מדא"גיות spreadsheet format. Available from the reports page under "מעקב כשירות גופנית". File is named `מעקב כשירות גופנית - {company} - {cycle}`.

### Export category

`ActivityType.exportCategory` (nullable string) maps activity types to one of four training categories: `physical` (אימון גופני), `test` (בוחן), `military` (אימון צבאי), `navigation` (ניווט). Only activities whose type has an `exportCategory` are included in this report. Configured in the admin activity types page.

### Sheet structure (matches IDF format)

One sheet per platoon. 13 columns per week (Sun-Fri = 6 days × 2 slots + Sat = 1), 30 weeks, 10 header rows, 50 soldier rows, 5 summary rows.

**Header rows (1-10):**
- Rows 1-2: Title ("מעקב השתתפות אחר חיילים באימונים"), merged A1:D2
- Row 3: Week numbers with ISO week ("שבוע X שבוע Y חיל האוויר"), each merged across 13 cols
- Row 4: Weekly topic (blank)
- Rows 5-6: Day names (Sun-Sat), merged 2 cols × 2 rows per weekday, 1 col × 2 rows for Sat
- Row 7: Dates (dd/mm), merged 2 cols per weekday
- Row 8: Training category per activity slot (NOT merged — each slot is independent)
- Row 9: Activity name per slot
- Row 10: Actual training (blank)

**Fixed columns (A-D):**
- A: מס״ד (serial number, 1-50)
- B: Participation percentage (passed / past activities with `date <= today`)
- C: Given name
- D: Family name

**Activity columns (E+):** Each activity maps to a day slot (2 per weekday, 1 for Sat). Activities are assigned to slots in date order.

**Cell value mapping:**
- `result=passed` → "ביצע מלא" (green background)
- `result=failed` with note → note text (yellow background)
- `result=failed` without note → "ביצע חלקי" (yellow background)
- `result=na` → "חייל לא פעיל" (yellow background)
- No report → empty cell

**Summary rows (5 rows after soldiers):**
1. מצבה פעילה — soldiers with any report for that activity
2. סה"כ משתתפים — passed count (option A: same as row 4)
3. לא ביצעו — failed count
4. סה"כ משתתפים מלא — passed count
5. אחוז משתתפים מלא — passed / active roster as percentage

**Formatting:** Frozen panes (10 rows + 4 cols), thin borders, grey header/footer background, 7pt font, 50px activity columns, compact 18px row heights.

### How note options work for this report

Activity types used for physical training should have their `displayConfiguration.note.options` configured with relevant attendance reasons (e.g., "רפואי גב", "חופשה מיוחדת", "צום"). Platoon commanders select from this dropdown when filing reports. The export uses the note text as the cell value, providing the detailed attendance reason the מדא"גיות officer needs.

### Key files
- API route: `src/app/api/reports/physical-training/sheets/route.ts`
- Reports page card: `src/app/(app)/reports/page.tsx`
- Reusable dialog: `src/components/reports/SheetsExportDialog.tsx` (accepts `apiEndpoint` + `reportType` props)
- Admin UI: `src/components/admin/ActivityTypeList.tsx` (export category dropdown)

### SheetsExportDialog is reusable

`SheetsExportDialog` accepts optional `apiEndpoint` (default: `/api/reports/all-activity/sheets`) and `reportType` (default: `"all-activity"`) props. Each report type stores its own default spreadsheet via `ReportExportDefault`. When adding a new Sheets-based report, create a new API route and pass the endpoint/type to the dialog.

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

### Cache clearing on sign-out

`src/lib/auth/sign-out.ts` exports `signOutAndClearCaches()` which sends a `CLEAR_CACHES` postMessage to the service worker before calling NextAuth's `signOut()`. The SW handler deletes all caches (app shells, runtime caches) to prevent sensitive data from persisting on shared devices after logout. Both sign-out buttons (Sidebar and profile page) use this function instead of calling `signOut()` directly.

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

### Native date/datetime-local inputs — iOS Safari overflow fix

Native `<input type="date">` and `<input type="datetime-local">` on iOS Safari have an intrinsic minimum width enforced by WebKit's shadow DOM that ignores standard CSS `min-width: 0` and `width: 100%`. This causes date inputs to overflow their containers on mobile, especially inside dialogs and cards with padding.

**The fix** (in `globals.css`) has three parts, all required:

1. **`-webkit-appearance: none`** on the input — removes browser chrome that enforces intrinsic sizing. The native date picker still opens on tap.
2. **Shadow DOM padding reset + picker indicator hidden** — zeroes padding on all `::‑webkit-datetime-edit-*` pseudo-elements and hides `::-webkit-calendar-picker-indicator` (which reserves invisible tap-target space).
3. **`min-width: 0` on all flex/grid ancestors** — Tailwind v4 `space-y-*` compiles to `flex-direction: column`, and flex items default to `min-width: auto` (intrinsic content size). A single ancestor without `min-width: 0` defeats everything below it. Applied via `[data-slot="dialog-content"] *` for dialogs and `[data-tour="request-details"] *` for the request detail card.

**Key gotchas:**
- **Desktop emulators don't reproduce the issue.** Only test on real iOS devices or the Xcode iOS Simulator.
- **`overflow-hidden` on containers clips but doesn't fix.** The input is still wider than its parent — it just gets clipped at the edge, eating into padding. The proper fix is making the input actually respect the container width.
- **`min-width: 0` must be on *every* flex/grid ancestor in the chain**, not just the direct parent. Walk up the DOM if overflow persists.
- **Hiding `::-webkit-calendar-picker-indicator` removes the calendar icon** on Chrome desktop. The native picker still works via click. If the icon is needed, it can be added back via a CSS pseudo-element.

### iOS PWA splash screen (`apple-touch-startup-image`)

iOS displays a static splash image while the PWA loads. Splash images are generated by `scripts/generate-splash.mjs` (19 device sizes, brand green `#273617` background with centered icon) and output to `public/splash/`. The directory is gitignored — images are regenerated on `npm install` via the `postinstall` script.

**Critical: `apple-mobile-web-app-capable` meta tag.** Next.js 15+ changed `appleWebApp.capable` to emit `<meta name="mobile-web-app-capable">` instead of the Apple-prefixed version ([vercel/next.js#70272](https://github.com/vercel/next.js/issues/70272)). iOS requires `<meta name="apple-mobile-web-app-capable" content="yes">` for splash screens to work — without it, splash images are silently ignored and the user sees a black screen during load. `layout.tsx` manually adds this tag in `<head>` to work around the Next.js change.

**`<html>` background color.** The `<html>` element has an inline `style={{ backgroundColor: "#fff" }}` and the theme init script sets it to `#1a1a1a` in dark mode. Without this, the HTML background is `rgba(0,0,0,0)` (transparent) during SSR, which shows as black on dark mode iOS in the gap between splash image dismissal and first paint.

**SW `/` → `/home` redirect.** The service worker intercepts navigations to `/` (the manifest `start_url`) and redirects locally to `/home`, skipping the server-side auth check + redirect that would otherwise add a Vercel cold start delay. This is safe because the `/home` shell handler does its own network fetch with auth.

**Splash images are cached at install time.** iOS reads the `<link rel="apple-touch-startup-image">` tags and downloads the matching image when the user adds the PWA to their home screen. Changes to splash images or meta tags require the user to delete and re-add the PWA.

### Startup diagnostics

`layout.tsx` records `performance.mark()` at key startup points (`theme-init`) and saves boot-time state (theme preference, dark mode, screen dimensions) to `sessionStorage` under `tironet:boot`. `AppShell` records `appshell-mount` and `splash-dismissed` marks. The support page (`/support`) collects these into a "Startup Timeline" and "Boot State" section in the diagnostics report, along with computed styles, splash image fetch test, and shell cache status.

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

### Guided tour (driver.js)

An interactive walkthrough runs on 8 pages: home, soldiers, activities, requests, calendar (list pages), and soldier detail, activity detail, request detail. Implementation:

- **`driver.js`** (v1.4) — lightweight step-by-step tour library. CSS imported globally in `src/app/layout.tsx`. RTL overrides in `globals.css` (class `.tironet-tour-popover`).
- **`useTour` hook** (`src/hooks/useTour.ts`) — wraps driver.js with versioned step support. Filters steps to only those whose `element` is visible in the DOM — handles role-based UI and mobile/desktop differences automatically.
- **`TourContext`** (`src/contexts/TourContext.tsx`) — each page registers its `startTour` function so the help button in `AppShell` (mobile) and `Sidebar` (desktop) can trigger the current page's tour.
- **Tour steps** (`src/lib/tour/steps.ts`) — Hebrew step configs per page using `VersionedStep` type (extends `DriveStep` with optional `version?: number`). Steps target `data-tour="..."` attributes on UI elements.
- **`data-tour` attributes** — added to key UI elements on each page. When both a desktop and mobile variant exist (e.g. desktop header button + mobile FAB), both get the same `data-tour` value; the `useTour` visibility check picks the one actually rendered.
- **Adding a tour to a new page:** (1) define steps in `steps.ts`, (2) add `data-tour` attributes to target elements, (3) call `useTour()` and register via `useTourContext()` in a `useEffect`. Place the hooks before any early returns so they're called unconditionally.

### Versioned tour steps (#168)

Tour steps support versioning so new features can be highlighted to returning users.

**How it works:**
- Each step has an optional `version` field (defaults to 1). Multiple steps can share the same version (e.g. a batch of features released together).
- `localStorage` stores the max version seen per page (`tironet:tour-seen:{page}` = version number). Legacy boolean `"1"` is treated as version 1 for migration.
- **First visit** (stored version = 0): full tour auto-starts, all steps shown.
- **Return visit with new steps** (stored version < max version): only steps with `version > storedVersion` are shown, each with a "חדש" (new) badge injected via `onPopoverRender`.
- **Help button**: always replays all steps without badges, regardless of version or preference.
- **User preference**: `showTour` boolean on `UserPreference` (server-persisted) gates auto-start. When false, no tours auto-start. Toggle on profile page under "העדפות כלליות".

**Adding new versioned steps:**
1. Add steps to the relevant array in `steps.ts` with `version: N` where N > current max
2. E2e helper (`e2e/helpers/auth.ts`) sets `tironet:tour-seen:*` to `"1"` (version 1) — if you add v2+ steps, update the stored value to match the max version to suppress tours in tests

### User Preferences (`UserPreference` model)

General user preferences (not notification-specific) are stored in the `UserPreference` model (one-to-one with User, server-persisted).

- **API:** `GET/PATCH /api/user-preferences` — same upsert pattern as notification preferences. Returns defaults if no row exists.
- **Context:** `UserPreferenceProvider` (`src/contexts/UserPreferenceContext.tsx`) wraps the app layout, fetches on mount, provides `{ showTour, loaded, updatePreference }`.
- **Profile page:** "העדפות כלליות" section between display mode and notifications.
- **Current fields:** `showTour` (Boolean, default true) — controls tour auto-start.

## PowerSync + React Rendering Gotchas (continued)

### `useStatus()` crashes during SSR

The `PowerSyncProvider` renders children **without** a context wrapper during SSR (`db` is `null` on the server). Calling `useStatus()` during SSR throws `Cannot read properties of null (reading 'currentStatus')`. Pages that are the first to load (e.g. `/home`) hit this because they're server-rendered. Pages reached via client navigation (e.g. `/activities`) don't because the context is already mounted.

**Workaround:** don't use `useStatus()` on pages that may be SSR'd. Use the `useSafeStatus()` wrapper from `src/hooks/useSafeStatus.ts` which returns safe defaults during SSR.

### `useSyncReady` hook — unified loading vs "no data" logic

All pages use `useSyncReady(hasData, isLoading)` from `src/hooks/useSyncReady.ts` to determine whether to show a loading indicator, "no data" message, or connection error. Both arguments come directly from `useQuery()`:

```tsx
const { data: rawSoldiers, isLoading: soldiersLoading } = useQuery<RawSoldier>(QUERY, params);
const { showLoading, showEmpty, showConnectionError } = useSyncReady(
  (rawSoldiers ?? []).length > 0,
  soldiersLoading
);
```

**Decision tree:**
- `isLoading` is true → show spinner/skeleton (query hasn't returned first results yet)
- `hasData` is true → render data
- `hasSynced` is true AND `downloading` is true → **stale sync detection** (see below) — show loading for 30s, then connection error
- `hasSynced` is true AND `downloading` is false → show "no data" / "not found" (sync completed, DB is genuinely empty)
- 15 seconds elapsed without sync → show connection error (first-time user, fully offline, no cached data)

### Stale sync detection (#137)

`hasSynced` persists from previous sync generations. When a sync resets (config change, new JWT claims, deployment), `hasSynced` remains true but the local DB has stale data from the old generation. On slow networks (e.g. military base cellular), the new sync may never complete its initial download — PowerSync requires ALL buckets to finish before checkpointing any data.

Without stale sync detection, `useSyncReady` sees `hasSynced: true` + no data → immediately shows "no data", which is misleading. The fix: when `hasSynced` is true AND `downloading` is true (sync actively receiving data) AND there's no data, show loading for 30s then connection error ("check your network"). The `downloading` guard prevents false positives on healthy networks — when a sync checkpoint completes quickly, `downloading` goes false and the hook falls through to the correct "genuinely empty" state.

### Stability principles — no timers for state decisions

**Do NOT** use `setTimeout` to decide between loading and empty states. Timers are guesses — they fire too early on slow networks (showing "no data" while still loading) and too late on fast ones (unnecessary delay). Always use signals from PowerSync (`isLoading`, `hasSynced`) or the browser (`navigator.onLine`).

The two timer exceptions in `useSyncReady` are **last-resort fallbacks** (15s for first-ever sync, 30s for stale sync) — they only fire when no signal-based resolution is possible and the alternative is an infinite spinner.

Similarly, **do not** add custom boolean flags to track loading/connected/bootstrapping state when a library signal already exists. Prior bugs came from maintaining `timedOut`, `grace`, `hasConnectedRef`, `wasOffline`, `reconnectGrace` etc. — all removed in favor of direct signals.

### Filtered views show empty states independently of `useSyncReady`

`useSyncReady` gates the **raw query** empty state (no data at all). Filtered views (e.g. requests "open" tab showing 0 of 14 requests, soldiers with "gaps" filter active) should show their empty message whenever the filtered list is empty and `showLoading` is false — they should **not** require `showEmpty` to be true, because the raw query returned data.

## Testing

### Unit Tests (Vitest)

Unit tests live in `__tests__/` directories alongside the code they test. Run with `npm test`. Coverage is ~98% line coverage across 408 tests.

Configuration is in `vitest.config.ts`. Tests use `vi.mock()` for Prisma, NextAuth, and other server dependencies. PowerSync hooks are mocked at the module level.

### E2E Tests (Playwright)

91 end-to-end tests across 12 spec files in `e2e/`. They run against the full stack (Next.js + PostgreSQL + PowerSync + Mailhog) via Docker Compose. Locally the suite runs in ~1 minute. CI uses 4 parallel workers and overlaps Docker/Next.js startup with npm/Playwright install to minimize idle time.

**Running:** `npm run e2e` (or `npm run e2e:ui` for the Playwright UI). The Docker Compose stack must be running with the e2e overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d
```

This creates a separate `tironet_test` database so e2e tests don't touch the dev DB. PowerSync is reconfigured to sync from `tironet_test`.

**Architecture:**
- `playwright.config.ts` defines 5 projects: `setup` (logs in 3 users via Mailhog), `admin-warmup` (pre-compiles admin routes), then `admin-tests`, `commander-tests`, `squad-tests` each using saved `storageState`
- `e2e/admin-warmup.ts` visits all admin pages and API endpoints before admin tests run, preventing Turbopack compilation-induced hangs (see gotcha #7)
- `e2e/global-setup.ts` seeds the test DB (Prisma), authenticates all 3 users in parallel via the magic link flow (Mailhog API), and saves auth state to `e2e/.auth/*.json`
- `e2e/global-teardown.ts` truncates all tables after the run

**Key gotchas for writing e2e tests:**

1. **Test isolation with `fullyParallel: true`** — Admin CRUD tests must NOT modify seeded data (cycles, activity types). Each test should create its own temporary data, operate on it, and leave seeded data untouched. Modifying seeded data (e.g. deactivating "Test Cycle 2026") breaks all PowerSync-dependent tests running in parallel.

2. **PowerSync sync timing** — Fresh browser contexts need 30–60 seconds for a full sync. Use `test.setTimeout(90000)` on describe blocks for PowerSync pages, and `{ timeout: 60000 }` on the first assertion that depends on synced data.

3. **Hebrew name display convention** — The UI displays soldiers as `familyName givenName` (e.g. "Cohen Avi", not "Avi Cohen"). All test assertions must use this order.

4. **Playwright strict mode** — Selectors matching multiple elements throw errors. Common fixes:
   - `.first()` when multiple matches are acceptable
   - `{ exact: true }` to avoid substring matches (e.g. `getByRole("button", { name: "טיוטה", exact: true })`)
   - Scope to `page.getByRole("main")` to avoid matching sidebar text (e.g. "Squad Commander" matching `getByText("Squad C")`)

5. **Sync scopes soldiers by squad for squad commanders** — PowerSync sync streams use the `visible_squad_ids` CTE, so squad commanders only receive their own squad's soldiers (not the full platoon). E2E tests should assert that squad commanders see only their squad's soldiers on these pages.

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

10. **Guided tour overlay blocks interactions** — The driver.js tour auto-starts on first visit and its SVG overlay intercepts all pointer events, causing clicks to fail. The `loginAndSaveState` helper sets `showTour: false` via the `/api/user-preferences` endpoint during login, which disables auto-start for all pages. No per-page localStorage management is needed.

## Environment Variable Naming

- Variables used inside the PowerSync Docker container must be prefixed `PS_` to work with the `!env` tag in `powersync.config.yaml`
- `POWERSYNC_JWT_SECRET` is the raw secret (used by Next.js to sign tokens) — no `PS_` prefix needed since Next.js reads it directly
- `PS_JWT_SECRET_B64URL` is its base64url encoding (used by PowerSync to verify tokens via JWKS) — needs `PS_` prefix
- `PS_JWT_AUDIENCE` is the allowed JWT audience value (must match `NEXT_PUBLIC_POWERSYNC_URL`)

## Push Notifications

### Architecture

Push notifications use the **Web Push API** (W3C standard) with **VAPID** authentication. No Firebase or Apple Developer account needed — the `web-push` npm package handles FCM (Chrome/Android) and Apple Push (Safari/iOS) endpoints transparently.

Key components:
- `src/lib/push/send.ts` — server-side utility for sending push via `web-push`. Handles stale subscription cleanup (410/404) and per-user preference checking.
- `src/hooks/usePushSubscription.ts` — client-side hook for managing browser push subscription state, permission, and iOS detection.
- `src/app/sw.ts` — `push` and `notificationclick` event listeners in the service worker.
- `src/app/api/push/subscribe/route.ts` — POST/DELETE for managing push subscriptions.
- `src/app/api/push/preferences/route.ts` — GET/PATCH for notification preference toggles.
- `src/app/api/cron/daily-tasks/route.ts` — Vercel Cron job for nightly squad commander reminders.

### Database models

- **`PushSubscription`** — per-device subscription (endpoint, p256dh, auth). One user can have multiple devices. Keyed by `endpoint` (unique).
- **`NotificationPreference`** — per-user opt-out toggles. One-to-one with User. Created automatically when a user subscribes to push; deleted when their last subscription is removed.

Neither model is synced via PowerSync — they are server-only.

### VAPID keys

Generated once with `npx web-push generate-vapid-keys`. Stored as environment variables:
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — used client-side in `PushManager.subscribe()`
- `VAPID_PRIVATE_KEY` — server-only, used to sign push messages
- `VAPID_SUBJECT` — `mailto:` URI identifying the application server

**Do not rotate VAPID keys** — all existing subscriptions become invalid if the public key changes.

### Notification types

| Notification | Trigger | Audience | Preference |
|---|---|---|---|
| Missing activity reports | Cron (20:00 Israel) | Squad commanders — own squad only | `dailyTasksEnabled` |
| Request requiring action | Event (create/workflow) | Squad/platoon/company commanders — own unit only | `requestAssignmentEnabled` |
| Active requests daily | Cron (20:00 Israel) | Squad + platoon commanders — own unit only | `activeRequestsEnabled` |
| New appointment added | Event (medical edit) | Squad + platoon commanders — own unit only | `newAppointmentEnabled` |

1. **Daily Tasks** (scheduled) — Vercel Cron at 20:00 Israel time (17:00 UTC) via `vercel.json`. Counts missing activity reports for today/yesterday per squad commander. Opt-out via `dailyTasksEnabled`.

2. **Request Assignment** (event-driven) — fires from three places:
   - `POST /api/requests` — when a new request is created, notifies users with the initially assigned role
   - `PATCH /api/requests/[id]` (online path) — when a workflow action (`data.action`) sets a new `assignedRole`
   - `PATCH /api/requests/[id]` (connector path) — when the PowerSync connector uploads a status/assignedRole change

   The notification title and body vary by request status: "בקשה חדשה" (open), "בקשה אושרה" (approved), "בקשה נדחתה" (denied). Both `notifyAssignedRole()` functions (in `route.ts` and `[id]/route.ts`) accept a `requestStatus` parameter. Notifications are scoped to the soldier's chain of command via `unitId` on `UserCycleAssignment`.

   Opt-out via `requestAssignmentEnabled`.

3. **Active Requests Daily** (scheduled) — same cron as daily tasks. Notifies squad and platoon commanders about approved requests (leave/medical) active on the target date. Scoped by the commander's assigned squads/platoons. Opt-out via `activeRequestsEnabled`.

4. **New Appointment Added** (event-driven) — fires from `PATCH /api/requests/[id]` when new medical appointments are detected (comparing old vs new `medical_appointments` JSON). Notifies the soldier's squad commander and platoon commander/sergeant. Opt-out via `newAppointmentEnabled`.

5. **Request Reminders** (scheduled via QStash) — per-commander advance reminders before medical appointments (with time component) and leave departures. Opt-in via `reminderLeadMinutes` (null = disabled, valid values: 15/30/60/120/180 minutes). See "Scheduled Reminders (QStash)" section below.

### Scheduled Reminders (QStash)

Reminders fire N minutes before medical appointments or leave departures, based on each commander's `reminderLeadMinutes` preference.

**Architecture:**
- **QStash** (Upstash) schedules future HTTP callbacks via `notBefore` timestamps
- **`ScheduledReminder`** table tracks each scheduled message (requestId, userId, appointmentId, qstashMessageId, scheduledFor, eventAt, fired)
- **`POST /api/reminders/fire`** — callback endpoint called by QStash when a reminder fires. Sends a push notification and marks the reminder as fired.
- **`GET /api/cron/fire-reminders`** — Vercel Cron safety net (every 30 min) that fires any reminders QStash failed to deliver, promotes far-future reminders to QStash once they enter the 7-day window, and cleans up fired reminders older than 30 days. The `fired` boolean prevents double-sends.

**QStash max delay (7 days):** QStash cannot schedule messages more than 7 days in the future. Reminders beyond this limit are stored in the DB with `qstashMessageId = null`. The cron poller promotes them to QStash once they enter the 7-day window. `publishReminder()` silently returns `null` for far-future reminders instead of throwing.

**Error isolation:** `rescheduleRemindersForUser` wraps each reminder in a try/catch so one failure doesn't abort the entire batch.

**Scope:** Medical appointments with a time component (date string contains `T`) and leave departures (`departureAt`). Date-only appointments are skipped. Recipients: squad commander + platoon commander/sergeant for the soldier. Both open (in-progress) and approved requests get reminders; denied requests cancel them.

**Key files:**
- `src/lib/reminders/qstash.ts` — QStash client wrapper (`publishReminder`, `cancelReminder`)
- `src/lib/reminders/schedule.ts` — Core scheduling logic (`scheduleRemindersForRequest`, `cancelAllRemindersForRequest`, `rescheduleRemindersForUser`)
- `src/app/api/reminders/fire/route.ts` — QStash callback endpoint
- `src/app/api/cron/fire-reminders/route.ts` — Safety-net cron poller

**Trigger points:** `scheduleRemindersForRequest(requestId)` is called via `after()` from:
- `POST /api/requests` (request creation)
- `PATCH /api/requests/[id]` (all three paths: workflow action, connector, field edit)
- `DELETE /api/requests/[id]` calls `cancelAllRemindersForRequest` before deletion

**Preference changes:** When a user updates `reminderLeadMinutes` via `PATCH /api/push/preferences`, `rescheduleRemindersForUser(userId)` cancels all existing reminders and creates new ones based on the updated lead time.

**Local development:** QStash local dev server runs in Docker Compose on port 8085 (`public.ecr.aws/upstash/qstash:latest`). The dev server prints its own token and signing keys on startup — use those values in `.env`. Set `QSTASH_URL=http://localhost:8085` and `APP_URL=http://host.docker.internal:3001` (3001 = Next.js dev port; the QStash container uses `host.docker.internal` to reach the host).

**Environment variables:**
- `QSTASH_TOKEN` — API token (from QStash dev server logs for local, from Upstash dashboard for prod)
- `QSTASH_URL` — QStash server URL (`http://localhost:8085` for dev; omit in prod — the SDK defaults to `https://qstash.upstash.io`)
- `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` — webhook signature verification (from dev server logs or Upstash dashboard)
- `APP_URL` — app URL for QStash callbacks (`http://host.docker.internal:3001` for dev; omit in prod — falls back to `NEXT_PUBLIC_APP_URL`)

### iOS limitations

iOS Safari only supports push for PWAs **installed to the Home Screen** (since iOS 16.4). The `usePushSubscription` hook detects non-installed iOS and shows guidance. `iosRequiresInstall` is `true` when the user is on iOS but not in standalone mode.

### Cron security

The `/api/cron/daily-tasks` endpoint validates `Authorization: Bearer <CRON_SECRET>`. Vercel automatically sends this header for configured cron jobs. Set `CRON_SECRET` in Vercel environment variables.

### PowerSync connector path vs online path — notification gotcha

Because this is an offline-first app, **all user mutations go through PowerSync** (local SQLite → connector → API). The connector uploads workflow actions as two separate operations: a PATCH to `/api/requests/[id]` with `status`/`assignedRole` fields (no `action` field), and a POST to `/api/request-actions` for the audit entry.

This means any server-side logic gated on `data.action` (the online-only workflow path) is **effectively dead code** — it only fires if someone calls the API directly, bypassing PowerSync. When adding side effects (like notifications) to workflow transitions, you must add them to **both** the `if (data.action)` block (online path) **and** the `if (data.status !== undefined || data.assignedRole !== undefined)` block (connector path). Similarly, request creation notifications must be in the `POST /api/requests` handler.

### `after()` is required for fire-and-forget work on Vercel

Vercel serverless functions terminate as soon as the response is sent. A bare `someAsyncWork().catch(...)` promise will be killed before it completes. Use `after()` from `next/server` to keep the function alive until the work finishes:

```typescript
import { after } from "next/server";

// Inside your route handler, BEFORE returning the response:
after(() =>
  sendPushToUsers(userIds, payload, "requestAssignmentEnabled").catch((err) =>
    console.warn("[push] notification failed:", err),
  ),
);

return NextResponse.json({ ... });
```

This applies to all fire-and-forget work: push notifications, analytics, logging, etc.

### Adding new notification types

1. Add a new preference field to `NotificationPreference` (Prisma schema + migration).
2. Add a toggle in the profile page's notifications section.
3. Call `sendPushToUsers()` with the new preference field name from the trigger point, wrapped in `after()`.
4. If the trigger is a workflow action, add the call to **both** the online and connector code paths (see gotcha above).
5. The push payload's `url` field determines where the notification click navigates.

## Support / Diagnostics Page

The `/support` page (`src/app/(app)/support/page.tsx`) is a client-side diagnostics tool accessible to all authenticated users via the sidebar/tab bar.

### How it works

1. **User submits a support report** — optional free-text description of the problem.
2. **`collectDiagnostics()`** gathers device, browser, storage, session, PowerSync status, table row counts, sync bucket state, JWT sync claims, oplog summary, sample queries, service worker status, and PWA state — all client-side.
3. **`POST /api/support`** (`src/app/api/support/route.ts`) sends the diagnostics as a formatted HTML email to `support@tironet.org.il` via the existing `sendEmail()` utility.

### What diagnostics are collected

- Device/browser info (user agent, screen size, standalone mode, online status)
- Storage estimate (OPFS usage and quota)
- Session info (user ID, email, isAdmin, selected cycle/role/unit) — **no soldier PII**
- PowerSync connection status, last sync time, upload errors
- Row counts for all synced tables (soldiers, squads, activities, etc.)
- `ps_buckets` state (bucket names and row counts — useful for debugging sync stream issues)
- JWT sync claims (cycle_ids, platoon_ids, squad_id, expiry)
- `ps_oplog` operation summary (PUT/REMOVE counts — helps detect bucket keying mismatches)
- Sample queries against the local DB to verify data availability
- Service worker registration state
- PWA install state and splash screen media query matches

### Navigation

The support page link appears in both `Sidebar.tsx` (desktop) and `AppShell.tsx` (mobile tab bar) for all roles. It is a standard `(app)` layout page — requires authentication, uses PowerSync context.
