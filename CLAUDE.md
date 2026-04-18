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

`useOnlineStatus()` in `src/hooks/useOnlineStatus.ts` uses `navigator.onLine` exclusively to determine device connectivity. The banner means "your device has no network" — it does **not** track PowerSync sync status. If the device is online but PowerSync can't connect (captive portal, server outage), data is still read/written locally and resyncs automatically when the issue resolves.

`hasPendingUploads` is true when `status.dataFlowStatus.uploadError` is set (failed upload attempt while offline) — this drives the "שינויים ממתינים לסנכרון" pill in `OfflineBanner`.

**Debounce:** online → offline transitions are debounced by 2 seconds so brief network blips don't flash the banner. Offline → online is instant (no delay).

**Do not** add PowerSync `status.connected` checks to the banner logic — this was tried previously and caused the banner to flash during hydration (#81) because PowerSync takes seconds to establish its WebSocket, during which `status.connected` is false even though the device is online. Page-level `useSyncReady()` handles the "can't load data" case separately.

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
- **"Open" logic:** A medical request is considered active (soldiers page badge) if **any** appointment is in the future.

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

### Audit trail (`RequestAction`)

Every workflow event (create, approve, deny, acknowledge, note) is recorded in the `request_actions` table. Each action stores `userId`, `action`, optional `note`, `userName` (denormalized for offline display), and `created_at`. The detail page renders a chronological timeline of all actions under "מהלך הטיפול".

Approve and deny actions open a dialog with an optional note field. The note is stored on the `RequestAction` row, not on the `Request` itself.

**Standalone notes:** Users can add a "note" action at any time via the "הוסף הערה" link. Notes have no effect on the workflow (no status or assignedRole change). Users can also edit the note text on their own actions as long as the request is not completed (`assignedRole !== null`). Edits are written to local SQLite via `db.execute("UPDATE request_actions SET note = ? WHERE id = ?", ...)` and synced by the connector via `PATCH /api/request-actions/[id]`.

The `userName` column is denormalized from the user's `familyName givenName` at write time so the timeline renders correctly offline (the `users` table is not synced via PowerSync).

### Authorization on request mutations

- **DELETE `/api/requests/[id]`** verifies `createdByUserId` matches the authenticated user — only the creator can delete their own open requests.
- **POST `/api/request-actions`** calls `getRequestScope()` and verifies the request's soldier is in the user's scope before creating an audit entry.
- **PATCH `/api/requests/[id]` (connector path)** validates that the `(status, assignedRole)` transition is reachable via a valid workflow action using `isValidTransition()` from `src/lib/requests/workflow.ts`. This prevents the PowerSync connector from bypassing the state machine (e.g. jumping directly from open to approved).

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
  - **Hardship**: always active (no date criterion)
  - Sorted by soonest relevant date first (departure date for leave, next appointment for medical). Hardship sorts last (no activity date).
- **Requires my action** (`דורשות טיפולי`): requests where `assignedRole !== null && canActOnRequest(userRole, assignedRole)` — cross-cuts open and active statuses

Denied requests pending acknowledgement (`status === "denied"`, `assignedRole !== null`) appear **only** in the "requires my action" tab — not in "pending" or "active". Completed denied requests (`assignedRole === null`) do not appear in any tab.

### Soldiers page "active requests" filter

The soldiers page has a "בקשות פתוחות" filter pill that shows soldiers with any open request (in progress or active, per `docs/DEFINITIONS.md`). A soldier passes the filter if they have `openRequestCount > 0` (requests with `status = 'open'` — in progress) **or** `approvedRequests.length > 0` (active approved requests from `OPEN_REQUESTS_QUERY`). The `OPEN_REQUESTS_QUERY` returns both in-progress and active requests, with urgency fields for the red dot indicator.

### Soldier detail page — full request history

The soldier detail page (`/soldiers/[id]`) shows **all** requests for the soldier in the current cycle, including completed denials and fully acknowledged approvals. This gives a complete picture of the soldier's request history. Approved requests that are currently active (per the definitions in `docs/DEFINITIONS.md`) show a green "פעילה" label next to the status badge.

### Shared request status utilities (`src/lib/requests/active.ts`)

`src/lib/requests/active.ts` exports three functions — do not duplicate this logic inline:

- **`isRequestActive(r, today?)`** — approved + leave with future dates, medical with future appointments, or hardship (always)
- **`isRequestOpen(r, today?)`** — in progress (`status === 'open'`) OR active. This is the umbrella "open" definition from `docs/DEFINITIONS.md`
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

### Invitation security

- **Send endpoints** (`/api/invitations/send-email`, `/api/invitations/send-sms`) verify the requester is the invitation creator or an admin before sending.
- **Tokens are never exposed in API responses.** All endpoints return `inviteUrl` (the full `/invite/{token}` URL) instead of the raw `token`. This applies to the admin list, admin refresh, hierarchy, and pending invitations endpoints.
- **Phone-only invitation acceptance** requires the accepting user to have a matching phone number. Users without a phone set are rejected with `phone_mismatch` (403).

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

An interactive walkthrough runs on 7 pages: home, soldiers, activities, requests (list pages), and soldier detail, activity detail, request detail. Implementation:

- **`driver.js`** (v1.4) — lightweight step-by-step tour library. CSS imported globally in `src/app/layout.tsx`. RTL overrides in `globals.css` (class `.tironet-tour-popover`).
- **`useTour` hook** (`src/hooks/useTour.ts`) — wraps driver.js. Auto-starts on first visit by observing the DOM via `MutationObserver` until a tour-targeted element is visible (no fixed delay). Tracks completion per page in `localStorage` (`tironet:tour-seen:<page>`). Filters steps to only those whose `element` is visible in the DOM — handles role-based UI and mobile/desktop differences automatically.
- **`TourContext`** (`src/contexts/TourContext.tsx`) — each page registers its `startTour` function so the help button in `AppShell` (mobile) and `Sidebar` (desktop) can trigger the current page's tour.
- **Tour steps** (`src/lib/tour/steps.ts`) — Hebrew step configs per page. Steps target `data-tour="..."` attributes on UI elements.
- **`data-tour` attributes** — added to key UI elements on each page. When both a desktop and mobile variant exist (e.g. desktop header button + mobile FAB), both get the same `data-tour` value; the `useTour` visibility check picks the one actually rendered.
- **Adding a tour to a new page:** (1) define steps in `steps.ts`, (2) add `data-tour` attributes to target elements, (3) call `useTour()` and register via `useTourContext()` in a `useEffect`. Place the hooks before any early returns so they're called unconditionally.

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

**Decision tree (no timers, no flags — driven entirely by PowerSync signals):**
- `isLoading` is true → show spinner/skeleton (query hasn't returned first results yet)
- `hasData` is true → render data
- `hasSynced` is true → show "no data" / "not found" (sync completed, DB is genuinely empty)
- 15 seconds elapsed without sync → show connection error (only edge case with a timer: first-time user, fully offline, no cached data — without it they'd see a spinner forever)

### Stability principles — no timers for state decisions

**Do NOT** use `setTimeout` to decide between loading and empty states. Timers are guesses — they fire too early on slow networks (showing "no data" while still loading) and too late on fast ones (unnecessary delay). Always use signals from PowerSync (`isLoading`, `hasSynced`) or the browser (`navigator.onLine`).

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

10. **Guided tour overlay blocks interactions** — The driver.js tour auto-starts on first visit and its SVG overlay intercepts all pointer events, causing clicks to fail. The `loginAndSaveState` helper pre-sets `tironet:tour-seen:*` localStorage flags for all 7 tour pages so tours never trigger during tests. If you add a new tour page, add its key to the list in `e2e/helpers/auth.ts`.

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

1. **Daily Tasks** (scheduled) — Vercel Cron at 20:00 Israel time (17:00 UTC) via `vercel.json`. Counts missing activity reports for today/yesterday per squad commander. Opt-out via `dailyTasksEnabled`.

2. **Request Assignment** (event-driven) — fires from three places:
   - `POST /api/requests` — when a new request is created, notifies users with the initially assigned role
   - `PATCH /api/requests/[id]` (online path) — when a workflow action (`data.action`) sets a new `assignedRole`
   - `PATCH /api/requests/[id]` (connector path) — when the PowerSync connector uploads a status/assignedRole change

   The notification title and body vary by request status: "בקשה חדשה" (open), "בקשה אושרה" (approved), "בקשה נדחתה" (denied). Both `notifyAssignedRole()` functions (in `route.ts` and `[id]/route.ts`) accept a `requestStatus` parameter.

   Opt-out via `requestAssignmentEnabled`.

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
