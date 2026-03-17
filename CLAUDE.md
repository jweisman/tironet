# Tironet — Claude Context

This file captures architectural decisions, constraints, and gotchas for Claude when working on this codebase.

## Tech Stack Summary

- **Next.js 16** App Router, TypeScript, Tailwind CSS v4
- **NextAuth v5** JWT strategy, Google OAuth + email magic link + WhatsApp OTP (Twilio Verify)
- **PostgreSQL** via Prisma ORM
- **PowerSync** (`@powersync/web` + `@powersync/react`) for offline-first sync — Sync Streams edition 3
- **PWA** via `@ducanh2912/next-pwa`

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
  SELECT id, activity_id, soldier_id, result, grade, note
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

### UMD worker setup for Next.js + Turbopack

Both PowerSync workers must be pointed at the pre-built UMD files. Without this, Turbopack tries to bundle them from source and hangs:

```typescript
// database.ts
new WASQLiteOpenFactory({
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

### `ActivityDetail` uses `useState(initialData)` — key on data content, not just IDs

`ActivityDetail` initializes its internal state with `useState(initialData)` and never syncs with prop changes. When the page builds `localData` from chained `useQuery` calls (activity → platoon params → squads → soldiers), React may mount `ActivityDetail` with partially-loaded data (correct squads, empty soldiers) before soldiers resolve in the next render cycle.

**Fix:** key the component on both squad IDs AND total soldier count so it remounts when soldiers arrive:

```tsx
<ActivityDetail
  key={`${data.squads.map(s => s.id).join(",")}-${data.squads.reduce((n, s) => n + s.soldiers.length, 0)}`}
  initialData={data}
/>
```

If you ever add another `useState(initialData)` component fed by chained `useQuery` params, apply the same pattern.

### Activity detail page uses activity-cycle assignment, not global context

The activity detail page (`/activities/[id]/page.tsx`) resolves the user's role and squad from the assignment matching `activity.cycle_id`, not from `selectedAssignment` in `CycleContext`. This handles users with assignments in multiple cycles correctly (e.g. squad_commander in a past cycle + platoon_commander in the current one).

## Data Model Constraints

### Squads cannot be reassigned between platoons

The `Soldier` → `Squad` → `Platoon` hierarchy is treated as immutable within a cycle. The API enforces this:
- `PATCH /api/admin/structure/[id]` only accepts `name` — no `platoonId` change
- `PATCH /api/soldiers/[id]` only accepts profile fields — no `squadId` change

This matters because PowerSync scopes `activity_reports` to users via a JOIN on `activities.platoon_id`. If a squad moved platoons mid-cycle, existing reports would fall out of sync scope. Do not add squad reassignment without also rethinking the sync strategy.

### Soldiers cannot be transferred between squads

Similarly, `Soldier.squadId` is write-once. The "transferred" status (`SoldierStatus.transferred`) marks a soldier as inactive rather than moving them.

## API Conventions

- All protected routes call `auth()` from `@/lib/auth/auth` and check `session.user`
- Admin routes use `requireAdmin()` from `@/lib/api/admin-guard`
- Non-admin data access is scoped via `getActivityScope()` which resolves the user's role and unit IDs for a given cycle
- Polymorphic FK: `UserCycleAssignment.unitId` points to `companies`, `platoons`, or `squads` depending on `unitType`. Referential integrity is enforced at the application layer, not by the DB.

## Environment Variable Naming

- Variables used inside the PowerSync Docker container must be prefixed `PS_` to work with the `!env` tag in `powersync.config.yaml`
- `POWERSYNC_JWT_SECRET` is the raw secret (used by Next.js to sign tokens) — no `PS_` prefix needed since Next.js reads it directly
- `PS_JWT_SECRET_B64URL` is its base64url encoding (used by PowerSync to verify tokens via JWKS) — needs `PS_` prefix
- `PS_JWT_AUDIENCE` is the allowed JWT audience value (must match `NEXT_PUBLIC_POWERSYNC_URL`)
