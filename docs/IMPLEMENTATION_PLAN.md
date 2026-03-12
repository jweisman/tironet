# Tironet — Implementation Plan

## Table of Contents

1. [Technology Decisions](#1-technology-decisions)
2. [Database Schema](#2-database-schema)
3. [Project Structure](#3-project-structure)
4. [Implementation Phases](#4-implementation-phases)
5. [Key Architectural Decisions](#5-key-architectural-decisions)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Open Questions & Risks](#7-open-questions--risks)

---

## 1. Technology Decisions

### 1.1 Framework — Next.js 15 (App Router)

**Choice:** Next.js 15 with the App Router and TypeScript.

**Rationale:**
- Specified in the PRD.
- App Router supports React Server Components, enabling fast initial page loads by streaming server-rendered HTML before client-side hydration.
- Route Groups (`(public)` / `(app)`) cleanly separate the unauthenticated landing experience from the authenticated app shell.
- API Routes (`/api/*`) serve as the PowerSync backend endpoint and NextAuth handlers without a separate server.

### 1.2 Authentication — NextAuth v5 (Auth.js)

**Choice:** NextAuth v5 with **JWT strategy** (not database sessions).

**Rationale:**
- JWT tokens are stored in an httpOnly cookie and can be read by the client-side PowerSync connector when online, then cached in `localStorage` / IndexedDB for offline session maintenance.
- Database sessions require a round-trip on every request — incompatible with offline-first.
- Two providers in Phase 1:
  - **Google OAuth** — requires a Google Cloud project with OAuth 2.0 credentials.
  - **Email (Magic Link)** — delivered via **Resend** (preferred) or Nodemailer. Resend has a generous free tier and a first-class Node.js SDK.
- Token expiry: 30-day JWT with sliding refresh. The refresh is handled by NextAuth's built-in token rotation.

**Key packages:**
```
next-auth@5         # Auth.js v5
@auth/prisma-adapter  # Wires NextAuth to Prisma for the accounts/verification_tokens tables
resend              # Magic link email delivery
```

### 1.3 Database — PostgreSQL + Prisma ORM

**Choice:** PostgreSQL (hosted on Supabase or Neon for production) with Prisma as the ORM.

**Rationale:**
- PostgreSQL is specified in the PRD.
- **Prisma** provides a type-safe query client generated from `schema.prisma`, automatic migration tracking with `prisma migrate`, and a Prisma Studio GUI for data inspection during development.
- Supabase and Neon both support the logical replication / WAL streaming that PowerSync requires.

**Key packages:**
```
prisma@^5           # CLI + migration engine
@prisma/client@^5   # Generated query client
```

### 1.4 Offline-First Sync — PowerSync

**Choice:** PowerSync (as suggested in the PRD).

**How it works:**

```
Postgres (source of truth)
    │
    │  WAL / logical replication
    ▼
PowerSync Service (cloud-hosted or self-hosted Docker)
    │
    │  WebSocket sync stream (JWT-authenticated)
    ▼
wa-sqlite (in-browser SQLite via WebAssembly)
    │
    │  Reads — all local, instant, offline-capable
    │
    │  Writes — local SQLite first (optimistic)
    │           → Upload Queue
    │           → Next.js API Route (/api/powersync/*)
    │           → Prisma → Postgres
    ▼
UI (React queries PowerSync local DB)
```

- **Sync Rules** (`sync-rules.yaml`) define which rows each user receives based on their JWT claims (cycle assignments, role, unit_id). This is the primary authorization boundary for data delivery.
- **Last-write-wins** (as specified): each table tracks `updated_at`; PowerSync's default conflict resolution keeps the latest timestamp.
- **Patch semantics**: mutations from the upload queue are sent as PATCH requests to avoid full-record overwrites; each API route validates authorization before writing to Postgres.

**Key packages:**
```
@powersync/web@^1          # PowerSync client for browser (includes wa-sqlite)
@powersync/kysely-sqlite@^1  # Type-safe local query layer (optional but recommended)
```

**PowerSync Service:** Use the PowerSync Cloud hosted service for production (free tier available). For local development, run via Docker:
```yaml
# docker-compose.yml (development only)
services:
  powersync:
    image: journeyapps/powersync-service:latest
    ports: ["8080:8080"]
    environment:
      POWERSYNC_JWT_SECRET: ${POWERSYNC_JWT_SECRET}
      DATABASE_URL: ${DATABASE_URL}
```

### 1.5 Internationalization — next-intl

**Choice:** `next-intl` with a single `src/messages/he.json` file. Hebrew-only in V1.

**Rationale:**
- The PRD explicitly asks whether to extract strings or embed them. Embedding strings works for V1, but using `next-intl` adds negligible overhead (~3 KB gzipped) while keeping all strings in one organized file and making future language addition (Arabic, English) a one-line change.
- `next-intl` supports App Router server components natively and has built-in RTL direction utilities.
- All string literals in components reference keys from `he.json` via the `useTranslations()` hook. No Hebrew strings are hardcoded in component files.

**Key packages:**
```
next-intl@^3
```

### 1.6 UI — Tailwind CSS + shadcn/ui

**Choice:** Tailwind CSS v4 + shadcn/ui component library, configured for RTL.

**Rationale:**
- Tailwind's utility-first approach produces small CSS bundles; v4 removes the need for a PostCSS config file.
- shadcn/ui provides accessible, unstyled-by-default Radix UI primitives (Dialog, Select, Sheet, Toast, etc.) that are copied into the project, meaning full customization is possible without fighting library internals.
- **RTL configuration:** Set `dir="rtl"` on the `<html>` element. Use Tailwind's `[dir=rtl]` variant and CSS logical properties (`ms-`, `me-`, `ps-`, `pe-` instead of `ml-`, `mr-`, `pl-`, `pr-`). The `tailwindcss-rtl` plugin provides `start`/`end` variants as a fallback for older Tailwind patterns.

**Image handling:**
- `browser-image-compression@^2` — client-side compression before upload. Target: ≤200 KB after compression, JPEG quality 0.8, max dimension 800px.
- `react-image-crop@^11` — crop/pan/zoom UI for profile pictures. Output as a base64-encoded JPEG data URL stored in the `profile_image` text column.

**Key packages:**
```
tailwindcss@^4
tailwindcss-rtl@^0.9
shadcn/ui (via CLI: npx shadcn@latest init)
react-image-crop@^11
browser-image-compression@^2
lucide-react@^0.400    # Icons (used by shadcn; also map activity type icons here)
```

### 1.7 PWA — next-pwa

**Choice:** `@ducanh2912/next-pwa` (maintained fork of `next-pwa` for Next.js 14/15 App Router compatibility).

**Configuration:**
- `manifest.json` with `display: "standalone"`, `dir: "rtl"`, `lang: "he"`, theme color matching the brand.
- Service worker caches the app shell (HTML, JS, CSS) and static assets with a stale-while-revalidate strategy.
- API routes are network-first (never cached by service worker — PowerSync handles offline data).

**Key packages:**
```
@ducanh2912/next-pwa@^10
```

### 1.8 Spreadsheet Import — xlsx

**Choice:** `xlsx` (SheetJS) for parsing CSV and Excel files on the client.

**Rationale:** Runs entirely in the browser (no server upload needed for parsing), supports `.xlsx` and `.csv`, and provides a template download path via `xlsx.utils.book_new()`.

**Key packages:**
```
xlsx@^0.18
```

### 1.9 Forms & Validation

**Choice:** React Hook Form + Zod.

- **React Hook Form** for controlled form state with minimal re-renders.
- **Zod** for schema-driven validation shared between client forms and API route request bodies.
- shadcn/ui's `<Form>` component wraps React Hook Form natively.

**Key packages:**
```
react-hook-form@^7
zod@^3
@hookform/resolvers@^3
```

---

## 2. Database Schema

All tables use UUID primary keys generated by Postgres (`gen_random_uuid()`). All timestamps are `TIMESTAMPTZ` with default `NOW()`. The schema is managed by Prisma and lives in `prisma/schema.prisma`.

### 2.1 Schema Diagram (Simplified)

```
cycles
  └── companies (cycle_id)
        └── platoons (company_id)
              └── squads (platoon_id)
                    └── soldiers (squad_id, cycle_id)

users
  └── user_cycle_assignments (user_id, cycle_id, role, unit_type, unit_id)
  └── invitations (invited_by_user_id, cycle_id)
  └── accounts (NextAuth)
  └── verification_tokens (NextAuth)

activities (platoon_id, cycle_id, activity_type_id)
  └── activity_reports (activity_id, soldier_id)

activity_types (standalone lookup)
```

### 2.2 Full Table Definitions

#### `users`
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
given_name     TEXT NOT NULL
family_name    TEXT NOT NULL
rank           TEXT                        -- Hebrew military rank string
is_admin       BOOLEAN NOT NULL DEFAULT false
email          TEXT NOT NULL UNIQUE
profile_image  TEXT                        -- base64 data URL, ≤200KB
created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `accounts` (NextAuth — OAuth account links)
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
type                TEXT NOT NULL          -- "oauth" | "email"
provider            TEXT NOT NULL          -- "google" | "email"
provider_account_id TEXT NOT NULL
refresh_token       TEXT
access_token        TEXT
expires_at          INT
token_type          TEXT
scope               TEXT
id_token            TEXT
session_state       TEXT
UNIQUE (provider, provider_account_id)
```

#### `verification_tokens` (NextAuth — magic link tokens)
```sql
identifier  TEXT NOT NULL
token       TEXT NOT NULL UNIQUE
expires     TIMESTAMPTZ NOT NULL
PRIMARY KEY (identifier, token)
```

#### `sessions` (NextAuth — retained for adapter compatibility; not actively used with JWT strategy)
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
session_token TEXT NOT NULL UNIQUE
user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
expires       TIMESTAMPTZ NOT NULL
```

#### `cycles`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
name        TEXT NOT NULL               -- e.g. "אוג 2025"
is_active   BOOLEAN NOT NULL DEFAULT true
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `companies`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
cycle_id    UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE
name        TEXT NOT NULL               -- e.g. "פלוגה בולדוג"
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `platoons`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE
name        TEXT NOT NULL               -- e.g. "מחלקה 1"
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `squads`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
platoon_id  UUID NOT NULL REFERENCES platoons(id) ON DELETE CASCADE
name        TEXT NOT NULL               -- e.g. "כיתה 2"
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `user_cycle_assignments`

This table is the authorization source of truth. A single user can have multiple rows (one per cycle, or multiple roles within a cycle at different units — though the PRD implies one primary assignment per cycle).

```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
cycle_id    UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE
role        TEXT NOT NULL  -- CHECK role IN ('company_commander','platoon_commander','squad_commander')
unit_type   TEXT NOT NULL  -- CHECK unit_type IN ('company','platoon','squad')
unit_id     UUID NOT NULL  -- FK to companies/platoons/squads depending on unit_type
                            -- enforced at application level, not DB FK (polymorphic)
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- role='company_commander' → unit_type='company'
-- role='platoon_commander' → unit_type='platoon'
-- role='squad_commander'   → unit_type='squad'
```

**Note on polymorphic `unit_id`:** Prisma does not natively support polymorphic foreign keys. The referential integrity is enforced at the application layer (in the API route mutation handlers). An alternative is three nullable FK columns (`company_id`, `platoon_id`, `squad_id`) with a check constraint that exactly one is non-null — use this if strict DB-level referential integrity is required.

#### `invitations`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
email            TEXT NOT NULL
invited_by_user_id UUID NOT NULL REFERENCES users(id)
cycle_id         UUID NOT NULL REFERENCES cycles(id)
role             TEXT NOT NULL  -- same enum as user_cycle_assignments.role
unit_type        TEXT NOT NULL
unit_id          UUID NOT NULL
token            TEXT NOT NULL UNIQUE    -- cryptographically random, 32 bytes hex
expires_at       TIMESTAMPTZ NOT NULL    -- 7 days from creation
accepted_at      TIMESTAMPTZ            -- NULL = pending
created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `soldiers`
```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
cycle_id       UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE
squad_id       UUID NOT NULL REFERENCES squads(id)
given_name     TEXT NOT NULL
family_name    TEXT NOT NULL
rank           TEXT
status         TEXT NOT NULL DEFAULT 'active'
               -- CHECK status IN ('active','transferred','dropped','injured')
profile_image  TEXT                     -- base64 data URL, ≤200KB
created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- A soldier belongs to one squad per cycle; squad_id can change (transfer)
-- but activity_reports remain linked to the soldier, not the squad
```

#### `activity_types`
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
name        TEXT NOT NULL               -- e.g. "ירי"
icon        TEXT NOT NULL               -- Lucide icon name or SVG string
is_active   BOOLEAN NOT NULL DEFAULT true
sort_order  INT NOT NULL DEFAULT 0
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Seed data (7 initial types):**
| name | icon | sort_order |
|------|------|-----------|
| אימונים | `dumbbell` | 1 |
| כש״ג | `shield` | 2 |
| ירי | `crosshair` | 3 |
| שיעורים | `book-open` | 4 |
| בוחנים | `clipboard-check` | 5 |
| הסמכות | `award` | 6 |
| שיחות מפקד | `message-circle` | 7 |

#### `activities`
```sql
id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
platoon_id        UUID NOT NULL REFERENCES platoons(id) ON DELETE CASCADE
cycle_id          UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE
activity_type_id  UUID NOT NULL REFERENCES activity_types(id)
name              TEXT NOT NULL               -- e.g. "כש״ג 1"
date              DATE NOT NULL DEFAULT CURRENT_DATE
is_required       BOOLEAN NOT NULL DEFAULT true
status            TEXT NOT NULL DEFAULT 'draft'
                  -- CHECK status IN ('draft','active')
created_by_user_id UUID NOT NULL REFERENCES users(id)
created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### `activity_reports`
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
activity_id         UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE
soldier_id          UUID NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE
result              TEXT NOT NULL
                    -- CHECK result IN ('passed','failed','na')
grade               NUMERIC                   -- optional, no boundaries
note                TEXT                      -- optional
updated_by_user_id  UUID NOT NULL REFERENCES users(id)
created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (activity_id, soldier_id)              -- one record per soldier per activity
```

### 2.3 Indexes

```sql
-- Performance-critical query paths
CREATE INDEX idx_soldiers_cycle_squad      ON soldiers(cycle_id, squad_id);
CREATE INDEX idx_soldiers_squad_status     ON soldiers(squad_id, status);
CREATE INDEX idx_activities_platoon_cycle  ON activities(platoon_id, cycle_id);
CREATE INDEX idx_activities_date           ON activities(date DESC);
CREATE INDEX idx_activity_reports_activity ON activity_reports(activity_id);
CREATE INDEX idx_activity_reports_soldier  ON activity_reports(soldier_id);
CREATE INDEX idx_user_assignments_user     ON user_cycle_assignments(user_id);
CREATE INDEX idx_user_assignments_cycle    ON user_cycle_assignments(cycle_id);
CREATE INDEX idx_invitations_token         ON invitations(token);
CREATE INDEX idx_invitations_email         ON invitations(email);
```

### 2.4 Gap Computation

Gaps are not stored; they are computed on-the-fly (both server-side in API routes and locally in PowerSync queries):

```sql
-- A gap is a (soldier, activity) pair where:
-- 1. The activity is required (is_required = true) AND active (status = 'active')
-- 2. The soldier is in the same platoon as the activity
-- 3. Either no activity_report row exists, OR result = 'failed'

SELECT
  s.id AS soldier_id,
  s.given_name || ' ' || s.family_name AS soldier_name,
  a.id AS activity_id,
  a.name AS activity_name,
  ar.result
FROM soldiers s
JOIN squads sq ON s.squad_id = sq.id
JOIN activities a ON a.platoon_id = sq.platoon_id
                 AND a.cycle_id = s.cycle_id
                 AND a.is_required = true
                 AND a.status = 'active'
LEFT JOIN activity_reports ar ON ar.activity_id = a.id
                              AND ar.soldier_id = s.id
WHERE s.status = 'active'
  AND (ar.id IS NULL OR ar.result = 'failed');
```

---

## 3. Project Structure

```
tironet/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                        # Seeds activity types + optional dev data
│
├── public/
│   ├── manifest.json                  # PWA manifest
│   ├── icons/                         # PWA icons (192, 512, maskable)
│   └── templates/
│       └── soldiers-template.xlsx     # Download template for bulk import
│
├── src/
│   ├── app/
│   │   ├── (public)/                  # Unauthenticated routes (no app shell)
│   │   │   ├── page.tsx               # Landing page
│   │   │   ├── login/
│   │   │   │   └── page.tsx           # Login page (Google + Magic Link buttons)
│   │   │   └── invite/
│   │   │       └── [token]/
│   │   │           └── page.tsx       # Accept invitation → trigger login
│   │   │
│   │   ├── (app)/                     # Authenticated routes (app shell)
│   │   │   ├── layout.tsx             # AppShell: TabBar + Sidebar + cycle context
│   │   │   ├── page.tsx               # Cycle picker (if multi-cycle) or → /home
│   │   │   ├── home/
│   │   │   │   └── page.tsx           # Dashboard
│   │   │   ├── soldiers/
│   │   │   │   ├── page.tsx           # Soldier list
│   │   │   │   ├── new/
│   │   │   │   │   └── page.tsx       # Add soldier form
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx       # Soldier profile
│   │   │   ├── activities/
│   │   │   │   ├── page.tsx           # Activity list
│   │   │   │   ├── new/
│   │   │   │   │   └── page.tsx       # Create activity (platoon commander only)
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx       # Activity detail + report
│   │   │   ├── profile/
│   │   │   │   └── page.tsx           # User profile (edit name, rank, picture)
│   │   │   └── admin/
│   │   │       ├── layout.tsx         # Admin guard (redirect if not is_admin)
│   │   │       ├── cycles/
│   │   │       │   └── page.tsx
│   │   │       ├── users/
│   │   │       │   └── page.tsx
│   │   │       ├── structure/
│   │   │       │   └── page.tsx       # Company → Platoon → Squad tree
│   │   │       └── activity-types/
│   │   │           └── page.tsx
│   │   │
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── [...nextauth]/
│   │   │   │       └── route.ts       # NextAuth handler
│   │   │   ├── powersync/
│   │   │   │   ├── token/
│   │   │   │   │   └── route.ts       # Issue PowerSync JWT for authenticated user
│   │   │   │   └── upload/
│   │   │   │       └── route.ts       # PowerSync upload queue endpoint
│   │   │   ├── invitations/
│   │   │   │   ├── route.ts           # POST: create invitation
│   │   │   │   └── [token]/
│   │   │   │       └── route.ts       # GET: validate token; POST: accept
│   │   │   ├── soldiers/
│   │   │   │   ├── route.ts           # GET list, POST create
│   │   │   │   └── [id]/
│   │   │   │       └── route.ts       # GET, PATCH, DELETE
│   │   │   ├── activities/
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts
│   │   │   │       └── reports/
│   │   │   │           └── route.ts   # GET all reports for activity; PATCH bulk update
│   │   │   ├── activity-reports/
│   │   │   │   └── [id]/
│   │   │   │       └── route.ts       # PATCH individual report
│   │   │   └── admin/
│   │   │       ├── cycles/
│   │   │       │   └── route.ts
│   │   │       ├── structure/
│   │   │       │   └── route.ts       # POST companies/platoons/squads
│   │   │       ├── users/
│   │   │       │   └── route.ts
│   │   │       └── activity-types/
│   │   │           └── route.ts
│   │   │
│   │   ├── layout.tsx                 # Root layout: <html dir="rtl" lang="he">
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── ui/                        # shadcn components (auto-generated)
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── form.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── sheet.tsx              # Mobile slide-up panels
│   │   │   ├── toast.tsx
│   │   │   └── ...
│   │   │
│   │   ├── layout/
│   │   │   ├── AppShell.tsx           # Wraps TabBar (mobile) or Sidebar (desktop)
│   │   │   ├── TabBar.tsx             # Bottom nav: Home / Soldiers / Activities
│   │   │   ├── Sidebar.tsx            # Desktop left nav
│   │   │   ├── CycleBadge.tsx         # Current cycle display + picker trigger
│   │   │   └── UserAvatar.tsx         # Profile picture → profile page link
│   │   │
│   │   ├── soldiers/
│   │   │   ├── SoldierList.tsx        # Grouped list with search/filter
│   │   │   ├── SoldierCard.tsx        # Row in list (avatar, name, rank, status)
│   │   │   ├── SoldierForm.tsx        # Add/edit soldier
│   │   │   ├── SoldierProfile.tsx     # Full profile with gap summary
│   │   │   ├── ImageCropper.tsx       # react-image-crop wrapper
│   │   │   └── BulkImport.tsx         # xlsx parse + preview table
│   │   │
│   │   ├── activities/
│   │   │   ├── ActivityList.tsx       # Sortable/filterable list
│   │   │   ├── ActivityCard.tsx       # Summary row (type icon, name, date, counts)
│   │   │   ├── ActivityForm.tsx       # Create/edit activity
│   │   │   ├── ActivityReport.tsx     # View/edit report switcher
│   │   │   ├── ReportRow.tsx          # Single soldier row in report
│   │   │   └── BulkUpdateBar.tsx      # "Mark all passed/failed" action bar
│   │   │
│   │   ├── dashboard/
│   │   │   ├── SquadSummaryCard.tsx   # Per-squad stats block
│   │   │   └── GapsList.tsx           # Top gaps display
│   │   │
│   │   └── admin/
│   │       ├── CycleForm.tsx
│   │       ├── StructureTree.tsx      # Company → Platoon → Squad tree editor
│   │       ├── ActivityTypeForm.tsx
│   │       └── InviteUserForm.tsx
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   └── prisma.ts              # Prisma client singleton (with connection pooling guard)
│   │   │
│   │   ├── auth/
│   │   │   ├── auth.ts                # NextAuth config (providers, callbacks, JWT)
│   │   │   └── permissions.ts         # RBAC helpers: canInvite(), canEditSoldier(), etc.
│   │   │
│   │   ├── powersync/
│   │   │   ├── schema.ts              # PowerSync local SQLite schema (mirrors Prisma schema)
│   │   │   ├── database.ts            # PowerSyncDatabase singleton + connector setup
│   │   │   └── sync-rules.yaml        # PowerSync sync rules (YAML DSL)
│   │   │
│   │   ├── email/
│   │   │   ├── sender.ts              # Resend client wrapper
│   │   │   └── templates/
│   │   │       ├── invitation.tsx     # React Email template for invitations
│   │   │       └── activity-notify.tsx # Squad commander notification
│   │   │
│   │   └── utils/
│   │       ├── image.ts               # compressImage(), cropImageToBase64()
│   │       ├── gaps.ts                # computeGaps() — pure function, used client + server
│   │       ├── hierarchy.ts           # getAncestors(), getDescendants() for unit tree
│   │       └── cn.ts                  # shadcn className utility
│   │
│   ├── hooks/
│   │   ├── useCycle.ts                # Current cycle from context
│   │   ├── usePowerSync.ts            # PowerSync query wrappers
│   │   ├── usePermissions.ts          # Current user's RBAC capabilities
│   │   └── useOnlineStatus.ts         # navigator.onLine + event listeners
│   │
│   ├── contexts/
│   │   └── CycleContext.tsx           # Selected cycle + setter (localStorage backed)
│   │
│   ├── types/
│   │   └── index.ts                   # Shared TypeScript types (Role, UnitType, Result, etc.)
│   │
│   └── messages/
│       └── he.json                    # All Hebrew UI strings (next-intl)
│
├── .env.local                         # Local dev secrets (gitignored)
├── .env.example                       # Template with all required vars
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── prisma/
│   └── schema.prisma
└── package.json
```

---

## 4. Implementation Phases

### Phase 1: Foundation

**Goal:** A running Next.js app with auth, RTL layout, database, and PWA shell. No business logic yet.

**Tasks:**

1. **Initialize project**
   ```bash
   npx create-next-app@latest tironet \
     --typescript --tailwind --eslint --app --src-dir
   ```
   Install core dependencies:
   ```bash
   npm install next-auth@beta @auth/prisma-adapter prisma @prisma/client \
     next-intl @ducanh2912/next-pwa zod react-hook-form @hookform/resolvers \
     lucide-react resend
   npx shadcn@latest init
   ```

2. **Configure RTL**
   - Set `<html dir="rtl" lang="he">` in `src/app/layout.tsx`.
   - Install `tailwindcss-rtl` plugin; add to `tailwind.config.ts`.
   - Test with a sample button that `ms-4` (margin-start) renders as `margin-right` in RTL.

3. **Set up next-intl**
   - Create `src/messages/he.json` with placeholder keys.
   - Create `src/i18n.ts` (next-intl config) and `middleware.ts` for locale routing (single locale `he`).
   - Wrap root layout with `NextIntlClientProvider`.

4. **Prisma schema + initial migration**
   - Write `prisma/schema.prisma` with all tables from Section 2.
   - Run `npx prisma migrate dev --name init`.
   - Create `prisma/seed.ts` to seed the 7 activity types.
   - Add `"prisma": { "seed": "ts-node prisma/seed.ts" }` to `package.json`.
   - Run `npx prisma db seed`.

5. **Configure NextAuth v5**
   - Create `src/lib/auth/auth.ts` with Google provider + Email provider (Resend adapter).
   - JWT strategy: encode user's `id`, `is_admin`, and `cycle_assignments` in the JWT.
   - Create `src/app/api/auth/[...nextauth]/route.ts`.
   - Create `src/app/(public)/login/page.tsx` with Google Sign-In button and Magic Link email input.
   - Implement the "unknown email" redirect: if `signIn` callback returns a user with no `user_cycle_assignments`, redirect to a `/not-authorized` page.

6. **App shell layout**
   - Create `src/app/(app)/layout.tsx` with session guard (redirect to `/login` if unauthenticated).
   - Build `AppShell`, `TabBar` (mobile, fixed bottom), `Sidebar` (desktop, fixed left) components.
   - Tabs: Home (`/home`), Soldiers (`/soldiers`), Activities (`/activities`).
   - `UserAvatar` in top-right (mobile) / bottom of sidebar (desktop) links to `/profile`.
   - Admin link visible only when `session.user.is_admin === true`.

7. **PWA configuration**
   - Create `public/manifest.json`.
   - Configure `@ducanh2912/next-pwa` in `next.config.ts`.
   - Add 192×192 and 512×512 app icons to `public/icons/`.
   - Verify installability in Chrome DevTools Lighthouse.

8. **Environment setup**
   - Create `.env.example` documenting all required variables (see Section 6).
   - Add `.env.local` to `.gitignore`.

**Deliverable:** Deployable skeleton. Auth works (Google + Magic Link), RTL renders correctly, tabs navigate, PWA installs on mobile.

**Validation checklist:**
- [ ] `docker compose up -d` — Postgres, Mailpit, and PowerSync containers start with no errors
- [ ] `npm run db:migrate` — migration runs to completion, no errors
- [ ] `npm run db:seed` — seeds 7 activity types; confirm via Prisma Studio (`npm run db:studio`)
- [ ] `npm run dev` — dev server starts with no TypeScript or compilation errors
- [ ] `npm run build` — production build succeeds; all pages listed in output; no TS errors
- [ ] Visit `http://localhost:3000` — landing page renders in Hebrew, text is right-aligned (RTL)
- [ ] Visit `http://localhost:3000/home` while logged out — redirects to `/login`
- [ ] Google OAuth: click "כניסה עם Google" → complete OAuth flow → redirected to `/home`
- [ ] Magic link: enter email → submit → email appears in Mailpit (`http://localhost:8026`) → click link → lands on `/home`
- [ ] Visit `/login` while already logged in → redirects to `/home`
- [ ] Resize browser to mobile width — bottom `TabBar` is visible; resize to desktop — `Sidebar` is visible
- [ ] Admin link is NOT visible for a non-admin user
- [ ] Admin link IS visible for a user with `isAdmin = true` in the DB

---

### Phase 2: Admin Foundation

**Goal:** Admins can set up the full data structure before any commanders are invited.

**Tasks:**

1. **Admin guard**
   - `src/app/(app)/admin/layout.tsx`: check `session.user.is_admin`; redirect to `/home` if false.
   - Add Admin link in `AppShell` (gear icon, only visible to admins).

2. **Cycle management** (`/admin/cycles`)
   - List all cycles with active/inactive badge.
   - "New Cycle" form: name field → `POST /api/admin/cycles`.
   - Toggle active/inactive → `PATCH /api/admin/cycles/[id]`.
   - API routes validate admin role before writing.

3. **Command structure** (`/admin/structure`)
   - `StructureTree` component: shows a collapsible tree (Companies → Platoons → Squads).
   - A cycle selector at the top scopes the tree to the selected cycle.
   - "Add Company" button → inline form → `POST /api/admin/structure` with `{ type: 'company', cycleId, name }`.
   - "Add Platoon" under a company → `{ type: 'platoon', companyId, name }`.
   - "Add Squad" under a platoon → `{ type: 'squad', platoonId, name }`.
   - Edit and delete (with confirmation) for each node.

4. **Activity types** (`/admin/activity-types`)
   - List with icon preview, name, active/inactive toggle.
   - "Add Type" form: name + icon picker (Lucide icon name input with live preview).
   - `PATCH /api/admin/activity-types/[id]` for edits.
   - Inactive types are greyed out and excluded from the activity creation form `<Select>`.

5. **Seed script enhancement**
   - `prisma/seed.ts` optionally creates a dev cycle, company, platoon, and squad when `NODE_ENV=development`.

**Deliverable:** Admin can fully configure a training cycle before inviting users.

**Validation checklist:**
- [x] Non-admin user visits `/admin` → redirected to `/home`
- [x] Admin user visits `/admin` → redirected to `/admin/cycles`
- [x] Admin sub-nav shows three tabs: מחזורים, מבנה פיקוד, סוגי פעילות
- [x] **Cycles:** add a new cycle → appears at top of list with "פעיל" badge
- [x] **Cycles:** toggle active/inactive switch → badge updates immediately
- [x] **Cycles:** click edit (pencil) → rename cycle → name updates in list
- [x] **Cycles:** click delete → confirmation dialog appears → confirm → cycle removed from list
- [x] **Structure:** cycle selector populates from existing cycles
- [x] **Structure:** add company → appears as collapsed row under selected cycle
- [x] **Structure:** expand company → add platoon → appears under company
- [x] **Structure:** expand platoon → add squad → appears under platoon
- [x] **Structure:** rename company, platoon, squad inline → name updates
- [x] **Structure:** delete squad (with confirmation) → removed; delete platoon cascades squads; delete company cascades all
- [x] **Activity types:** add type with a valid Lucide icon name (e.g. `Dumbbell`) → icon preview renders correctly
- [x] **Activity types:** invalid icon name → renders `?` placeholder
- [x] **Activity types:** toggle active/inactive → badge updates
- [x] **Activity types:** edit name and icon → updates in list
- [x] **Activity types:** delete (with confirmation) → removed from list
- [x] Calling any admin API without an admin session (e.g. via DevTools `fetch`) → returns `403`

---

### Phase 3: Users & Invitations

**Goal:** The invitation flow works end-to-end. Commanders can manage users in their hierarchy.

**Tasks:**

1. **Permission helpers** (`src/lib/auth/permissions.ts`)
   - `canInviteRole(currentRole, targetRole): boolean` — enforces the hierarchy rules from the PRD.
   - `getAccessibleUnits(assignment): { companies, platoons, squads }` — returns the units a user can see/edit based on their role and unit_id.
   - `canEditUser(currentUser, targetUser): boolean`.

2. **Invitation creation**
   - `InviteUserForm` component: email, role selector (filtered to roles the inviter can assign), unit selector (filtered to units in their hierarchy), cycle selector.
   - `POST /api/invitations`: validate permissions, generate 32-byte hex token, set `expires_at = NOW() + 7 days`, save to DB, send invitation email via Resend.
   - Invitation email template (`src/lib/email/templates/invitation.tsx`): Hebrew HTML email with role, unit name, cycle name, and a CTA button linking to `/invite/[token]`.

3. **Invitation acceptance flow**
   - `src/app/(public)/invite/[token]/page.tsx`: validates token (not expired, not accepted), shows role/unit summary, prompts user to log in.
   - On login success, NextAuth `signIn` callback checks for a pending invitation matching the authenticated email:
     - Creates `user_cycle_assignments` row.
     - Marks invitation as accepted (`accepted_at = NOW()`).
     - Redirects to `/home`.
   - If invitation has expired: show error with "contact your commander" message.

4. **User management screen** (`/admin/users` for admins; also accessible to commanders for their hierarchy)
   - Table: name, rank, email, role, unit, cycle, actions.
   - Inline edit: role and unit (constrained to the editor's hierarchy).
   - "Invite User" button opens `InviteUserForm` in a `Sheet` (slide-up on mobile, side panel on desktop).
   - `PATCH /api/admin/users/[id]` for edits. Validate that new unit_id is within editor's hierarchy.

5. **Cycle picker** (`src/app/(app)/page.tsx`)
   - On entry: fetch the current user's `user_cycle_assignments` where `cycles.is_active = true`.
   - If 0 cycles → `/not-authorized`.
   - If 1 cycle → save to `CycleContext` + `localStorage`; redirect to `/home`.
   - If 2+ cycles → render `CyclePicker` UI (cards with cycle name and role).
   - `CycleContext` reads from `localStorage` on mount; the selected cycle persists across sessions.
   - "Change Cycle" accessible from the `CycleBadge` in the app header.

6. **User profile page** (`/profile`)
   - Edit given/family name, rank.
   - Profile picture: file input (accept `image/*`, `capture="user"` for mobile camera) → `ImageCropper` → `compressImage()` → base64 stored via `PATCH /api/users/me`.
   - Display current cycle assignments (read-only).

**Deliverable:** Full invite → auth → role assignment flow. Users land in the app with correct permissions.

**Validation checklist:**
- [x] Admin creates an invitation → confirmation shown; email delivered to recipient's inbox
- [x] Invitation email is in Hebrew; contains role label, unit name, cycle name, and a working CTA link
- [x] Recipient clicks invite link → sees role/unit summary page → logs in → lands on `/home` with the assigned role
- [x] Accessing the same invite link a second time (already accepted) → shows "already used" error
- [ ] Manually set `expires_at` in the past in DB → visit invite link → shows expired error with "contact your commander" message
- [x] Inviter (platoon commander) cannot invite a role above their own (e.g. company commander) — form does not offer that role option
- [x] Inviter cannot select units outside their hierarchy in the invite form
- [ ] `/admin/users` shows table with name, rank, email, role, unit, cycle for all users
- [x] Admin edits a user's role and unit → changes saved and reflected in table
- [x] User with **0** active cycle assignments → redirected to `/not-authorized` after login
- [x] User with **1** active cycle → cycle auto-selected; lands directly on `/home`
- [ ] User with **2+** active cycles → cycle picker shown; selecting one proceeds to `/home`
- [x] Reload page after selecting a cycle → same cycle still selected (persisted in `localStorage`)
- [x] "Change Cycle" control accessible from app header → cycle picker re-opens
- [x] Profile page: edit given name, family name, rank → saved and reflected in sidebar/avatar
- [x] Profile page: upload and crop a profile picture → avatar updated throughout the app

---

### Phase 4: Soldiers

**Goal:** Commanders can manage soldiers. Soldier data is visible throughout the app.

**Tasks:**

1. **Soldier list** (`/soldiers`)
   - `SoldierList` component: for squad commander → flat list; for platoon commander → grouped by squad; for company commander → grouped by platoon then squad.
   - Each row: `SoldierCard` (avatar, name, rank, status badge, gap indicator).
   - Search bar: client-side filter on `given_name + family_name` (Hebrew-aware, case-insensitive).
   - Filter toggle: "Show only soldiers with gaps" — queries `computeGaps()` and filters list.
   - "Add Soldier" FAB (floating action button, bottom-right on mobile).

2. **Add soldier form** (`/soldiers/new`)
   - Fields: given name, family name, rank, squad (hidden for squad commander, defaulting to their squad), status (default `active`), profile picture (optional).
   - `POST /api/soldiers`: validate that the target squad is in the user's hierarchy; create soldier.
   - **Late-joiner prompt:** after soldier creation, check if any `active` activities exist for the soldier's squad. If yes, show a confirmation dialog: "קיימות X פעילויות. לסמן אותן כ-לא רלוונטי?" → if confirmed, bulk-create `activity_reports` with `result='na'` for all existing activities.

3. **Soldier profile** (`/soldiers/[id]`)
   - Header: avatar, name, rank, status, squad.
   - Gap summary section: list of activities where result is missing or failed (uses `computeGaps()`).
   - Edit button → `SoldierForm` in edit mode.
   - Profile picture crop/upload.

4. **CSV/Excel bulk import**
   - "Import" button on soldier list → `BulkImport` component (Sheet panel).
   - Parse uploaded file using `xlsx`; map columns to soldier fields.
   - Show preview table with validation errors highlighted.
   - "Download Template" button → generate and download `soldiers-template.xlsx` with headers.
   - On confirm: `POST /api/soldiers/bulk` with array of soldiers.

5. **Template spreadsheet**
   - Generate via `xlsx` in a server-side utility: columns `שם פרטי`, `שם משפחה`, `דרגה`, `סטטוס`.
   - Save static file at `public/templates/soldiers-template.xlsx`.

**Deliverable:** Soldiers can be added individually or in bulk. Soldier profiles show gaps. Search and filter work.

**Validation checklist:**
- [x] Squad commander: soldier list shows only their squad's soldiers
- [x] Platoon commander: list is grouped by squad with section headers
- [ ] Company commander: list is grouped by platoon → squad
- [x] Search bar: type a Hebrew name → list filters in real time (case-insensitive)
- [x] "Show gaps only" toggle: list reduces to soldiers with at least one missing or failed activity report
- [x] Add soldier (individually): all required fields validated; soldier appears in list after save
- [x] Add soldier: squad field hidden for squad commander (defaults to their squad automatically)
- [x] Add soldier when active activities exist for the squad → late-joiner dialog appears asking about N/A
- [x] Late-joiner: confirm "N/A" → `activity_reports` rows created with `result = na` for all existing active activities; verify in Prisma Studio
- [ ] Late-joiner: decline → soldier added with no activity reports created
- [x] Soldier profile page: shows avatar, name, rank, status, squad
- [x] Soldier profile: gap summary lists all activities with missing or failed result
- [x] Soldier profile: edit button opens form in edit mode; changes saved correctly
- [x] Bulk import: "Download Template" → downloads `.xlsx` with correct Hebrew column headers
- [x] Bulk import: upload filled template → preview table shows rows; invalid rows highlighted with error description
- [x] Bulk import: confirm → valid soldiers imported; verify count in DB via Prisma Studio
- [x] Bulk import: file with no valid rows → helpful error message; nothing imported

---

### Phase 5: Activities & Reports

**Goal:** The core workflow — creating activities and reporting results — is fully functional.

**Tasks:**

1. **Activity list** (`/activities`)
   - `ActivityList` component: sorted by date descending (default).
   - Each row: `ActivityCard` — activity type icon + name, date, required badge, status badge, completed/missing/failed counts.
   - Activities with missing reports are highlighted (amber left border or background tint).
   - Filter bar: "השבוע" (last 7 days), "עם פערים" (has gaps), "טיוטה" (draft status).
   - Sort: date, name (toggle asc/desc).

2. **Create activity** (`/activities/new`) — platoon commander only
   - Fields: activity type (select from active types), name, date (date picker, default today), required (checkbox, default checked), status (radio: draft / active).
   - On submit: `POST /api/activities`.
   - After creation: optional "שלח הודעה למ״כים" button → `POST /api/activities/[id]/notify` → sends email to all squad commanders in the platoon.
   - Email template (`activity-notify.tsx`): Hebrew, includes activity name, type, date, link to `/activities/[id]`.

3. **Activity detail + report** (`/activities/[id]`)
   - Header: activity metadata (editable inline for platoon commander).
   - View/Edit mode toggle (edit accessible to squad commander for their squad, platoon commander for all).
   - **View mode:** table of soldiers with result icon (✓ passed, ✗ failed, — N/A, blank = missing). Gap rows highlighted in red/amber.
   - **Edit mode:**
     - `BulkUpdateBar` pinned at top: "סמן הכל כ: [עבר] [נכשל] [לא רלוונטי]". Bulk action only fills rows with no existing value.
     - `ReportRow` per soldier: avatar + name, result select (3 options + clear), grade input (numeric, optional), notes input (optional).
     - Auto-save on blur / result change (debounced `PATCH /api/activity-reports/[id]` or `POST` for new records).
     - Unsaved indicator if offline.

4. **Activity edit**
   - Platoon commanders can edit activity metadata (type, name, date, required, status) via `PATCH /api/activities/[id]`.
   - Changing status from `draft` → `active` makes it visible to squad commanders.

5. **Report PATCH semantics**
   - `PATCH /api/activity-reports/[id]`: partial update (result, grade, or note independently).
   - `POST /api/activities/[id]/reports/bulk`: accept `{ result, soldierIds[] }` — upsert, but only for soldiers without an existing result (enforces "bulk only fills missing" rule).

**Deliverable:** Complete activity lifecycle from creation to reporting. 30-second squad update target is achievable with bulk update + exceptions pattern.

**Validation checklist:**
- [x] Activity list: sorted by date descending by default
- [x] Filters: "השבוע" shows only activities from the last 7 days; "עם פערים" shows only activities with missing/failed reports; "טיוטה" shows only draft activities
- [x] Create activity: form is accessible to platoon commander; squad commander does not see the create button
- [x] Create activity: submit with all fields → activity appears in list with correct type icon, date, and status badge
- [x] Draft activity: NOT visible to squad commanders in the list
- [x] Change status draft → active: activity becomes visible to squad commanders
- [ ] "Notify squad commanders" after creation → emails delivered (check Mailpit in dev); email is in Hebrew with activity name, type, date, and a working link
- [x] Activity detail (view mode): table shows all squad soldiers with result icons (✓ passed, ✗ failed, — N/A, blank = missing); gap rows highlighted
- [x] Switch to edit mode: bulk "סמן הכל כ: עבר" → only fills soldiers with no existing result; soldiers with existing results unchanged
- [x] Edit mode: set individual result, grade, note for a soldier → auto-saved on blur; verify in Prisma Studio without manually saving
- [x] Edit mode: change result → row updates immediately (optimistic UI)
- [x] Platoon commander: can edit activity metadata (name, date, type, required, status)
- [x] Squad commander: cannot edit activity metadata; can only fill reports for their own squad
- [ ] Activity reports API: `POST /api/activities/[id]/reports/bulk` with `soldierIds` that already have results → existing results untouched; only empty ones filled

---

### Phase 6: Dashboard

**Goal:** Commanders have an at-a-glance overview of their hierarchy's status.

**Tasks:**

1. **Dashboard data query** (`/home`)
   - For each squad in the user's hierarchy, compute:
     - Total active soldiers.
     - Count of (soldier, activity) pairs by status: completed, missing, failed.
     - Top 3 activities with the most gaps (activity name + gap count).
   - These queries run against the PowerSync local DB for instant load (offline-capable).

2. **`SquadSummaryCard` component**
   - Squad name + commander name(s).
   - Soldier count.
   - Activity stats (completed ✓, missing ⚠, failed ✗) — tappable → navigates to `/activities` with squad filter applied.
   - Top gaps list — tappable → navigates to `/activities/[id]` with gaps filter and squad pre-selected.

3. **Role-based rendering**
   - Squad commander: one `SquadSummaryCard`.
   - Platoon commander: one card per squad in the platoon; aggregate totals shown at platoon level.
   - Company commander: cards grouped by platoon; platoon-level aggregate cards + expandable squad detail.

4. **User context header**
   - User's rank + given name.
   - Current cycle name.
   - Role label (מ״כ / מ״מ / מ״פ).

**Deliverable:** Dashboard provides the "at-a-glance" view described in the PRD.

**Validation checklist:**
- [ ] Squad commander: dashboard shows exactly one squad summary card
- [ ] Platoon commander: dashboard shows one card per squad plus a platoon-level aggregate row
- [ ] Company commander: cards grouped by platoon; platoon aggregate visible; squads expandable
- [ ] Each card shows correct soldier count, completed/missing/failed activity counts
- [ ] Tapping/clicking the "missing" or "failed" count navigates to `/activities` with the correct squad filter pre-applied
- [ ] Top gaps list shows up to 3 activities with the highest gap count; tapping one navigates to `/activities/[id]`
- [ ] User context header shows: rank + given name, current cycle name, role label (מ״כ / מ״מ / מ״פ)
- [ ] Add a new activity report and return to dashboard — counts update to reflect the change

---

### Phase 7: Offline-First (PowerSync)

**Goal:** The app works fully without an internet connection. Data syncs automatically when reconnected.

**Tasks:**

1. **PowerSync Service setup**
   - Production: provision PowerSync Cloud account; connect to Postgres instance; obtain `POWERSYNC_URL`.
   - Development: add `powersync` service to `docker-compose.yml`.

2. **Sync rules** (`src/lib/powersync/sync-rules.yaml`)
   - Define buckets per user based on JWT claims:
     ```yaml
     bucket_definitions:
       user_data:
         parameters:
           - name: user_id
             value: token.sub
         data:
           - SELECT * FROM users WHERE id = bucket.user_id
           - SELECT * FROM user_cycle_assignments WHERE user_id = bucket.user_id
       
       cycle_data:
         parameters:
           - name: cycle_id
             value: token.cycle_ids[*]     # array from JWT
         data:
           - SELECT * FROM cycles WHERE id = bucket.cycle_id
           - SELECT * FROM companies WHERE cycle_id = bucket.cycle_id
           - SELECT * FROM platoons WHERE company_id IN (SELECT id FROM companies WHERE cycle_id = bucket.cycle_id)
           - SELECT * FROM squads WHERE platoon_id IN (...)
           - SELECT * FROM activity_types WHERE is_active = true
       
       platoon_data:
         parameters:
           - name: platoon_id
             value: token.platoon_ids[*]   # all platoons in user's hierarchy
         data:
           - SELECT * FROM soldiers WHERE squad_id IN (SELECT id FROM squads WHERE platoon_id = bucket.platoon_id)
           - SELECT * FROM activities WHERE platoon_id = bucket.platoon_id
           - SELECT * FROM activity_reports WHERE activity_id IN (SELECT id FROM activities WHERE platoon_id = bucket.platoon_id)
     ```
   - JWT must include `cycle_ids` and `platoon_ids` arrays (populated in NextAuth JWT callback from `user_cycle_assignments`).

3. **PowerSync JWT endpoint** (`/api/powersync/token`)
   - Validates the NextAuth session (httpOnly cookie).
   - Issues a PowerSync-specific JWT (signed with `POWERSYNC_JWT_SECRET`) containing the user's `sub`, `cycle_ids`, and `platoon_ids`.
   - PowerSync client calls this endpoint to get a fresh JWT before connecting.

4. **PowerSync client** (`src/lib/powersync/database.ts`)
   - Initialize `PowerSyncDatabase` with `wa-sqlite` backend.
   - `PowerSyncConnector` implementation:
     - `fetchCredentials()`: calls `/api/powersync/token`; caches result; refreshes before expiry.
     - `uploadData(database)`: dequeues pending `CrudTransaction`s; sends each as a PATCH/POST/DELETE to the appropriate `/api/*` route; marks as uploaded.
   - Export a singleton `db` instance; initialize in `AppShell` on mount.

5. **Replace server data fetching with local queries**
   - Replace `fetch('/api/soldiers')` calls with `db.execute('SELECT * FROM soldiers WHERE ...')`.
   - Use `db.watch()` for reactive queries (re-renders automatically when data changes).
   - Write operations: call `db.execute('INSERT/UPDATE/DELETE ...')` which writes locally and enqueues for sync.

6. **Offline indicator**
   - `useOnlineStatus()` hook monitors `navigator.onLine` and the PowerSync sync status.
   - Show a subtle banner when offline: "אין חיבור לאינטרנט — שינויים יסונכרנו בהתחברות".
   - Pending upload count badge visible in the UI when there are unsynced changes.

7. **Service worker**
   - `next-pwa` handles static asset caching automatically.
   - Ensure API routes are excluded from SW cache (network-only for auth endpoints; PowerSync WebSocket is managed by its own client).

**Deliverable:** App functions in airplane mode. All mutations are queued and synced on reconnect.

**Validation checklist:**
- [ ] Open app while online; then disable network in Chrome DevTools (Network → Offline)
- [ ] Navigate between pages — app renders from local PowerSync DB without any network requests
- [ ] Create or edit an activity report while offline → offline banner appears; pending upload badge increments
- [ ] Re-enable network → pending changes upload automatically; verify data persisted in Postgres via Prisma Studio
- [ ] Open app in airplane mode from scratch (no prior cache) → app shell loads; cached data visible
- [ ] Lighthouse PWA audit (DevTools → Lighthouse → Progressive Web App) — passes installability checks
- [ ] Install app as PWA on Android Chrome (or iOS Safari) → opens as standalone without browser chrome
- [ ] Sync status indicator: shows "מסונכרן" when online and in sync; shows pending count when changes are queued
- [ ] PowerSync JWT endpoint (`/api/powersync/token`) returns 401 for unauthenticated requests

---

### Phase 8: Polish & QA

**Goal:** Production-ready quality — performance, accessibility, security, cross-platform.

**Tasks:**

1. **Loading states & optimistic updates**
   - Every mutation shows a loading spinner on the submit button; replace with success/error toast.
   - Activity report rows optimistically update the result icon immediately on change (before sync confirmation).
   - Skeleton loaders for lists on first load.

2. **Error handling**
   - API routes return structured `{ error: string, code: string }` JSON for all error cases.
   - Client-side `useToast()` (shadcn) displays Hebrew error messages for common failures.
   - Unhandled errors caught by a React error boundary at the `(app)` layout level.

3. **Mobile UX polish**
   - All interactive targets ≥ 44×44px (WCAG 2.5.5).
   - `BulkUpdateBar` uses a large fixed bottom bar (above the `TabBar`) for easy thumb reach.
   - Swipe-to-dismiss on Sheet components.
   - `ReportRow` result select uses a full-screen bottom sheet on mobile instead of a dropdown.

4. **Performance audit**
   - Run Lighthouse in Chrome DevTools; target score ≥ 90 Performance.
   - Verify pages load < 2 seconds on a simulated Slow 4G connection.
   - Ensure `profile_image` base64 strings are not included in list queries (select specific columns).
   - Lazy-load `ImageCropper` and `BulkImport` with `next/dynamic` (they are large dependencies).

5. **Cross-browser testing**
   - Chrome (desktop + Android): full feature test.
   - Safari iOS: PWA install, camera access for profile pictures, IndexedDB (wa-sqlite) compatibility.
   - Firefox: basic functional test.

6. **Security review**
   - All API routes re-validate the session and assert RBAC before any DB write (never trust client-provided `userId`).
   - Invitation tokens: check `expires_at > NOW()` and `accepted_at IS NULL` on every use.
   - Prisma parameterized queries prevent SQL injection by default.
   - Profile image upload: validate base64 string; enforce server-side size limit (reject if > 250KB after decode).
   - `Content-Security-Policy` header in `next.config.ts`.
   - CORS restricted to production domain for API routes.
   - Rate limiting on `/api/auth/*` and `/api/invitations` routes (use `@upstash/ratelimit` with Redis or `lru-cache` for simple in-memory rate limiting).

7. **Accessibility**
   - All form fields have associated `<label>` elements.
   - Icon-only buttons have `aria-label` in Hebrew.
   - Color is never the sole indicator of state (gap highlighting uses both color and an icon).
   - Keyboard navigation works for all interactive elements.

**Deliverable:** Production-ready app passing Lighthouse audits, security review, and cross-device testing.

**Validation checklist:**
- [ ] Every form submission shows a loading spinner on the button during the request
- [ ] Successful mutation → Hebrew success toast appears and auto-dismisses
- [ ] Failed mutation → Hebrew error toast with the relevant message
- [ ] Activity report row updates result icon immediately on change before the server response (optimistic UI)
- [ ] Skeleton loaders appear on first list load before data arrives
- [ ] Lighthouse (DevTools → Lighthouse, Slow 4G, Mobile): Performance ≥ 90, PWA passes
- [ ] All tappable targets measure ≥ 44×44px in DevTools device emulation (use "Show rulers" overlay)
- [ ] `BulkUpdateBar` positioned above the `TabBar` on mobile — reachable with thumb without scrolling
- [ ] Tab through all form fields with keyboard — focus order is logical; Enter submits the active form
- [ ] All icon-only buttons have a Hebrew `aria-label` (inspect in DevTools Accessibility panel)
- [ ] Enable a colour-blind simulation in DevTools (Rendering → Emulate vision deficiency) — gap indicators still distinguishable by icon, not colour alone
- [ ] Chrome Android: full feature test; install as PWA; use camera for profile picture upload
- [ ] Safari iOS: install to home screen; open offline; edit a report; reconnect — report synced
- [ ] Firefox (desktop): navigate all major flows; no JS errors in console
- [ ] Unauthenticated `fetch` to any `/api/admin/*` route → `403`; to any `/api/*` route → `401`
- [ ] Rapid requests to `/api/auth/*` (>threshold) → `429 Too Many Requests`
- [ ] Invitation token: expired → error page; already accepted → error page; wrong email → sign-in blocked
- [ ] Profile image upload larger than 250 KB (after decode) → server rejects with a clear error
- [ ] `npm run build` → zero TypeScript errors, zero ESLint errors, all pages in build output

---

## 5. Key Architectural Decisions

### 5.1 Offline-First Data Flow

All reads go through the PowerSync local SQLite database. All writes are:
1. Written to local SQLite immediately (optimistic, instant UI response).
2. Enqueued in the PowerSync upload queue.
3. Uploaded to the Next.js API route when online.
4. Written to Postgres via Prisma.
5. Propagated back to all clients via the PowerSync sync stream.

This means the UI never waits for a network response to show a result update. The 30-second squad update requirement is met even on spotty field connectivity.

### 5.2 Authorization at Two Layers

Authorization is enforced at two independent layers:

**Layer 1 — PowerSync Sync Rules:** Users only receive rows they are authorized to see. A squad commander never has platoon-level data in their local DB. This is enforced server-side in the PowerSync Service before data is streamed.

**Layer 2 — API Route RBAC:** Every mutation API route independently re-validates:
- Is the requester authenticated? (NextAuth session)
- Does the requester's `user_cycle_assignments` include permission to mutate the target entity?
- Is the target entity within the requester's hierarchy?

Client-side `usePermissions()` is used only to show/hide UI elements — never as a security boundary.

### 5.3 Polymorphic Unit References

The `user_cycle_assignments.unit_id` and `invitations.unit_id` columns are polymorphic (reference different tables depending on `unit_type`). This is a trade-off: it simplifies queries but sacrifices DB-level referential integrity.

**Mitigation:** The `hierarchy.ts` utility (`getAncestors`, `getDescendants`) is the single source of truth for resolving unit relationships. All RBAC checks go through this utility. A future migration could normalize this into three nullable FK columns if referential integrity becomes a concern.

### 5.4 Image Storage in Postgres

Profile images are stored as base64-encoded strings in `users.profile_image` and `soldiers.profile_image`. This is a deliberate trade-off (simpler than S3, no separate storage service) with the following guardrails:
- Client-side compression to ≤200KB via `browser-image-compression` before encoding.
- Server-side validation rejecting images > 250KB.
- Images are **excluded from list queries** — only fetched when loading an individual record.
- PowerSync syncs the full soldier record including `profile_image`; this is acceptable given the size limit and the offline-first requirement.

### 5.5 Internationalization Strategy

`next-intl` is used with a single `src/messages/he.json` file. All Hebrew strings in components reference keys from this file via `useTranslations('namespace')`. Hebrew strings are **never hardcoded** in component files.

This adds ~5 minutes of setup time compared to embedding strings, but provides:
- A complete audit trail of all UI strings in one place.
- Easy QA for text reviews.
- Trivial addition of a second language in a future phase.

### 5.6 Activity Report Semantics

The PRD states "only the latest result is saved." This is implemented as a `UNIQUE (activity_id, soldier_id)` constraint with upsert semantics (`INSERT ... ON CONFLICT DO UPDATE`). There is no history table in V1 (the PRD lists "audit log" as a future addition). The `updated_by_user_id` column records who made the last change.

### 5.7 Gap Computation

Gaps are computed dynamically, never stored. The `computeGaps()` function in `src/lib/utils/gaps.ts` is a pure function that accepts soldiers, activities, and reports as input and returns gap records. It runs:
- **Server-side** in API routes that need gap counts for dashboard data.
- **Client-side** against PowerSync local DB data for instant offline computation.

This avoids maintaining a derived `gaps` table that could go stale.

---

## 6. Environment Variables Reference

```bash
# .env.example

# Database
DATABASE_URL="postgresql://user:password@host:5432/tironet"

# NextAuth
NEXTAUTH_URL="https://tironet.example.com"
NEXTAUTH_SECRET="<32+ char random string>"

# Google OAuth
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# Email (Resend)
RESEND_API_KEY="re_..."
EMAIL_FROM="Tironet <noreply@tironet.example.com>"

# PowerSync
POWERSYNC_URL="https://your-instance.powersync.journeyapps.com"
POWERSYNC_JWT_SECRET="<32+ char random string>"

# App
NEXT_PUBLIC_APP_URL="https://tironet.example.com"
```

---

## 7. Open Questions & Risks

### Q1: PowerSync free tier limits
The PowerSync Cloud free tier supports up to 3 connected users and 10,000 sync operations/day. Evaluate whether a paid plan is needed based on expected concurrent user count. Self-hosting (Docker) is a zero-cost alternative for smaller deployments.

### Q2: wa-sqlite browser compatibility
`wa-sqlite` requires WebAssembly + Origin Private File System (OPFS) for best performance. OPFS is supported in Chrome 102+ and Safari 16.4+. For older browsers, it falls back to a memory-based SQLite (data lost on refresh). Verify the target device base supports OPFS.

### Q3: Hebrew full-text search
Soldier search by name uses client-side JS filter against the PowerSync local DB. For large cohorts (100+ soldiers), this is fast enough. Postgres-side search (if needed later) can use `pg_trgm` for Hebrew trigram search.

### Q4: Multiple commanders per squad (mid-cycle transfers)
The `user_cycle_assignments` table supports multiple rows per cycle (one per commander). When a squad has two commanders, both can edit activity reports for that squad. The `updated_by_user_id` column records the last editor. No locking mechanism is implemented in V1 (last write wins, per PRD).

### Q5: Image sync bandwidth
If a cycle has 100 soldiers each with a 200KB profile image, the initial sync payload for a new device is ~20MB. This is acceptable on a mobile data connection (~10 seconds on 3G) but should be noted. A future optimization is to sync image thumbnails during initial sync and lazy-load full images on demand.

### Q6: Activity report audit trail
The PRD flags "audit log" as a future addition. In V1, only the last result is stored. If commanders need to know whether a soldier passed after previously failing, this information is lost. Consider adding an `activity_report_history` table in Phase 2 if this becomes a requirement before the audit log feature is built.
```

---

### Critical Files for Implementation

- `/Users/josh/Downloads/טירונט/docs/PRD.md` - Source of truth for all requirements; reference throughout all phases
- `prisma/schema.prisma` - The single file that defines the entire data model; must be written first before any API routes or PowerSync schema can be built
- `src/lib/auth/auth.ts` - NextAuth configuration tying together JWT strategy, Google/Magic Link providers, and the invitation acceptance callback; all protected routes depend on it
- `src/lib/powersync/sync-rules.yaml` - Defines what data each user receives offline; the primary authorization boundary for the offline-first architecture; must be designed carefully before PowerSync integration begins
- `src/lib/auth/permissions.ts` - RBAC helper functions used by every API route mutation handler; centralizing this logic prevents authorization bypasses across the codebase