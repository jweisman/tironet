# Tironet — Military Training Management

A web application for managing IDF training cycles: soldiers, activities, attendance reports, and hierarchical command access. Built for use in the field with a mobile-first, Hebrew (RTL) interface.

## Features

- **Training hierarchy** — Cycles → Companies → Platoons → Squads → Soldiers
- **Role-based access** — Admins, company commanders (and deputies), platoon commanders (and sergeants), squad commanders, instructors (activity-focused), company medics (medical request-focused), and hardship coordinators (hardship request-focused) each see only their slice of the hierarchy
- **Activity management** — Create training activities, assign them to platoons, and record per-soldier results (pass / fail / N/A) with up to 6 labeled scores per activity type and notes; bulk import activities from Excel/CSV
- **Bulk reporting** — Update an entire squad's activity results in one action; import reports from Excel/CSV with user-defined column mapping (saved per activity type)
- **Requests workflow** — Leave, medical, and hardship requests with a hierarchical approval chain (squad → platoon → company commander), commander notes on approve/deny, role-based editing and deletion, and full offline support
- **Calendar** — Monthly calendar view showing activities, leave requests, medical appointments, and sick days across the user's scope; color-coded by platoon or event type with filtering; mobile-optimized with iOS Calendar-style dots and day detail list; PDF export (landscape A4, one month per page); available to all roles including squad commanders
- **Reports** — Activity summary (PDF with pie charts and grade tables by unit), all-activity matrix (Google Sheets), physical training tracker (Google Sheets, IDF מדא"גיות format), and approved request summary (PDF grouped by unit); all scoped by role and filterable by type
- **Dashboard** — Today's activities with progress bars, today's active requests (leave/medical), and live summary cards per squad (squad/platoon commander) or per platoon (company-level roles)
- **Soldier profiles** — Photo upload with in-browser cropping and compression; bulk import from Excel
- **Invitation system** — Admins invite users by email or SMS; each invitation scopes the user to a specific unit and role
- **Authentication** — Google OAuth, email magic link (Nodemailer), and SMS OTP (Twilio Verify)
- **Admin panel** — Manage cycles, companies, platoons, squads, activity types, and users
- **Push notifications** — Daily task reminders for squad commanders (missing activity reports), real-time request assignment alerts, and scheduled reminders before medical appointments and leave departures (via QStash); opt-out per notification type and configurable reminder lead time in the profile page
- **Guided tour** — Interactive walkthrough (driver.js) on each main page; auto-starts on first visit, re-launchable via the help button in the header/sidebar
- **Support & diagnostics** — In-app support page that collects device, browser, PowerSync sync status, table row counts, and JWT claims, then emails a formatted diagnostic report to the support team
- **Company branding** — Upload a company logo (admin structure page) displayed on the dashboard; falls back to the IDF emblem
- **Offline-first** — Activity reports can be recorded and bulk-updated without a network connection; changes sync automatically when connectivity is restored
- **PWA** — Installable on iOS (Add to Home Screen) and Android; works as a standalone app with full offline support

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth | NextAuth v5 (JWT strategy) |
| Database | PostgreSQL via Prisma ORM |
| UI | Tailwind CSS v4, shadcn/ui (Base UI), Lucide icons |
| Internationalisation | next-intl (Hebrew / RTL) |
| Email | Nodemailer (dev: Mailhog; prod: SMTP) |
| OTP | Twilio Verify (SMS) |
| Image processing | browser-image-compression, react-easy-crop |
| Drag & drop | dnd-kit |
| Excel import | xlsx |
| Push notifications | web-push (VAPID / Web Push API) |
| PWA / Service Worker | @serwist/turbopack |
| Offline sync | PowerSync (Sync Streams edition 3, self-hosted via Docker) |
| Deployment | Vercel (production), Docker Compose (local dev) |

## Offline Capabilities

The app is designed to work reliably in low-connectivity field environments. All offline data is stored in a local SQLite database (via PowerSync + OPFS) and syncs automatically when connectivity is restored.

### What works offline

- **Home dashboard** (`/home`) — Cached shell with live data from local SQLite. Shows activity completion rates, gap counts, and missing reports.
- **Soldier list** (`/soldiers`) — Browse the full soldier roster with gap counts, powered by local queries.
- **Soldier detail pages** (`/soldiers/[id]`) — View soldier profile, status, and gap activities. Any soldier can be viewed offline — the service worker caches a single HTML shell that works for all soldier IDs.
- **Activity list** (`/activities`) — Browse all activities assigned to the user's platoons.
- **Activity detail pages** (`/activities/[id]`) — View and manage per-soldier results. Same shell caching as soldier detail pages — any activity can be viewed offline.
- **Recording activity reports** — Pass/fail/N/A results, multiple scores, and notes can be saved while offline. Writes go to local SQLite instantly; the connector uploads them to the server when connectivity is restored.
- **Bulk squad updates** — The bulk "mark all" action also works offline under the same mechanism.
- **Editing soldiers** — Soldier profile fields (name, rank, status) can be updated offline.
- **Requests** — Creating requests and performing workflow actions (approve, deny, acknowledge) all work offline. Changes sync when connectivity is restored.

### What requires connectivity

- Logging in (authentication is always server-side)
- Creating new activities
- Admin operations (structure changes, user management, invitations)
- User profile page
- Pages not listed above show a friendly offline fallback with a link back to the home page

### How it works

The service worker proactively caches HTML shells for all main routes (`/home`, `/activities`, `/soldiers`, and detail page templates) immediately after registration. On subsequent visits, the SW serves the cached shell and PowerSync provides data from local SQLite — no network round-trip needed.

On each deployment, the SW clears stale caches and re-fetches fresh shells. RSC payloads are never cached (they are version-specific), preventing stale-cache errors after updates.

### Offline indicator

A banner appears at the top of every page when the connection is lost, including a "pending changes" pill when unsynced writes are queued. The banner uses `navigator.onLine` for immediate detection (appears within milliseconds of going offline), supplemented by PowerSync's WebSocket connection status. The offline state persists across page reloads so the banner appears instantly even after navigation-triggered reloads.

### Installing as a PWA

**Android (Chrome):** An "Install app" banner appears automatically the first time the installability criteria are met. Tap "התקן" to install.

**iOS (Safari):** A banner with instructions appears on first visit. Tap the Share button → "Add to Home Screen". Other iOS browsers (Chrome, Firefox) do not support PWA installation.

Once installed, the app runs in standalone mode (no browser chrome) and the install prompt is permanently suppressed.

## Local Development

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### 1. Clone and install

```bash
git clone <repo-url>
cd tironet
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env        # Docker Compose reads .env
cp .env.example .env.local  # Next.js reads .env.local
```

Edit both files and fill in the values (see [Environment Variables](#environment-variables) below).

> **Note:** Docker Compose reads `.env` (not `.env.local`). Next.js reads `.env.local`. Keep them in sync for variables shared between the app and the Docker services (e.g. `POWERSYNC_JWT_SECRET`). Running `docker compose up -d` after changing `.env` picks up the new values; `docker compose restart` does not.

### 3. Start services

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5434`
- **MongoDB** on port `27017` (PowerSync storage, runs as a replica set)
- **PowerSync** on port `8080` (offline sync service)
- **Mailhog** SMTP on port `1026`, web UI at `http://localhost:8026`
- **QStash** on port `8085` (scheduled reminder delivery — see logs for auth token and signing keys)

### 4. One-time infrastructure setup

These two commands are required on first run (or after wiping Docker volumes).

**Create the PostgreSQL logical replication publication** (required by PowerSync WAL streaming):
```bash
docker compose exec postgres psql -U tironet -d tironet -c "CREATE PUBLICATION powersync FOR ALL TABLES;"
```

**Initialise the MongoDB replica set** (PowerSync requires a replica set, even single-node):
```bash
docker compose exec mongo mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'mongo:27017'}]})"
```

You should see `{ ok: 1 }`. The PowerSync container will automatically connect and begin replication.

### 5. Run database migrations and seed

```bash
npm run db:migrate   # run Prisma migrations
npm run db:seed      # seed activity types and a sample cycle
```

### 6. Start the dev server

```bash
npm run dev
```

App runs at `http://localhost:3001` (see `NEXTAUTH_URL` in `.env.example`).

> **Note:** The service worker is disabled in development to avoid stale-cache conflicts with hot module reloading. To test PWA and offline features, run a production build (`npm run build && npm start`) and open the app in a browser that supports service workers.

### 7. Create the first admin user

Sign in with Google or magic link, then run:

```bash
npm run make-admin -- --email you@example.com
```

### Useful dev commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server on port 3001 |
| `npm run build` | Production build (runs migrations + prisma generate) |
| `npm start` | Start production server (requires a prior build) |
| `npm run db:migrate` | Run pending Prisma migrations |
| `npm run db:seed` | Seed reference data |
| `npm run db:studio` | Open Prisma Studio at localhost:5555 |
| `npm run make-admin -- --email <email>` | Promote a user to admin |
| `npm test` | Run unit tests (Vitest) |
| `npm run e2e` | Run e2e tests (Playwright) — requires Docker e2e stack |
| `npm run e2e:ui` | Run e2e tests with Playwright UI |

## Testing

### Unit Tests (Vitest)

```bash
npm test
```

Runs 499 unit tests with ~98% line coverage. Tests cover API routes, auth logic, PowerSync connector, React components, and utility functions. Configuration is in `vitest.config.ts`.

### E2E Tests (Playwright)

E2E tests run against the full stack in a browser. They use a separate `tironet_test` PostgreSQL database and a separate `powersync_e2e` MongoDB database, so they don't affect dev data or PowerSync replication state.

#### Prerequisites

The Docker Compose stack must be running with the e2e overlay, which creates the test database and points PowerSync at it:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d
```

If this is the first run (or after wiping volumes), also run the one-time infrastructure setup commands from [step 4](#4-one-time-infrastructure-setup) above, replacing `tironet` with `tironet_test` for the PostgreSQL publication:

```bash
docker compose exec postgres psql -U tironet -d tironet_test -c "CREATE PUBLICATION powersync FOR ALL TABLES;"
```

#### Running

```bash
npm run e2e        # headless run
npm run e2e:ui     # Playwright UI (interactive)
```

The test suite (81 tests across 12 spec files) takes ~1 minute locally (~5–6 minutes in CI). Tests cover authentication, navigation guards, admin CRUD (cycles, structure, activity types, users), invitation flow, dashboard, activities, soldiers, and the requests workflow (creation, approval chain, denial with notes, cross-role handoffs).

The setup phase automatically:
1. Runs Prisma migrations against the test database
2. Seeds test data (users, cycles, companies, platoons, squads, soldiers, activities, reports)
3. Authenticates 3 test users (admin, platoon commander, squad commander) via the magic link flow using Mailhog
4. Saves auth state to `e2e/.auth/` for reuse across all tests

After running e2e tests, switch back to dev with a normal `docker compose up -d` — no cleanup needed. The e2e overlay isolates both the PostgreSQL and MongoDB databases, so there are no replication slot conflicts.

## Environment Variables

Copy `.env.example` to both `.env` (Docker) and `.env.local` (Next.js) and fill in:

```bash
# PostgreSQL — host-accessible URL (used by Next.js / Prisma)
DATABASE_URL="postgresql://tironet:tironet@127.0.0.1:5434/tironet"

# PostgreSQL — Docker-internal URL (used by PowerSync container)
# sslmode=disable is required; the local Postgres container does not support SSL
PS_DATABASE_URL="postgresql://tironet:tironet@postgres:5432/tironet?sslmode=disable"

# NextAuth — generate with: openssl rand -base64 32
AUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3001"
AUTH_TRUST_HOST=true

# Google OAuth (https://console.cloud.google.com/apis/credentials)
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."

# Google Picker (for exporting reports to existing Google Sheets)
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY="..."
NEXT_PUBLIC_GOOGLE_APP_ID="..."  # Numeric project number from Cloud Console

# Email / SMTP
# Dev: Mailhog (started by docker compose)
EMAIL_SERVER="smtp://localhost:1026"
FROM_EMAIL="Tironet <noreply@yourdomain.com>"

# Twilio Verify — for SMS OTP auth
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_VERIFY_SERVICE_SID="..."

# PowerSync — offline sync service
POWERSYNC_URL="http://localhost:8080"
NEXT_PUBLIC_POWERSYNC_URL="http://localhost:8080"

# Shared JWT secret for PowerSync token signing/verification
# Generate with: openssl rand -base64 32
POWERSYNC_JWT_SECRET="..."
# base64url of the raw secret bytes (used in powersync.config.yaml via !env)
# Derive with: echo -n "$POWERSYNC_JWT_SECRET" | base64 | tr '+/' '-_' | tr -d '='
PS_JWT_SECRET_B64URL="..."
# JWT audience — must match NEXT_PUBLIC_POWERSYNC_URL (dev: http://localhost:8080)
PS_JWT_AUDIENCE="http://localhost:8080"

# Push notifications (VAPID) — generate with: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:admin@yourdomain.com"

# Cron secret — generate with: openssl rand -base64 32
CRON_SECRET="..."

# Public app URL (used in invitation emails)
NEXT_PUBLIC_APP_URL="http://localhost:3001"

# QStash — scheduled reminders (values from `docker compose logs qstash`)
QSTASH_TOKEN="<from QStash dev server logs>"
QSTASH_URL="http://localhost:8085"
QSTASH_CURRENT_SIGNING_KEY="<from QStash dev server logs>"
QSTASH_NEXT_SIGNING_KEY="<from QStash dev server logs>"
APP_URL="http://host.docker.internal:3001"
```

## Production Deployment (Vercel)

### 1. Database

Provision a managed PostgreSQL instance (e.g. [Neon](https://neon.tech) or [Supabase](https://supabase.com)) and obtain a connection string. Enable SSL on the connection.

Prisma migrations run automatically during the Vercel build via the `build` script:
```json
"build": "npx prisma migrate deploy && npx prisma generate && next build"
```

### 2. PowerSync

PowerSync can be self-hosted or run via [PowerSync Cloud](https://www.powersync.com). For production:

- Self-hosted: expose the PowerSync Docker service behind a TLS-terminating reverse proxy and set `NEXT_PUBLIC_POWERSYNC_URL` to the public HTTPS URL.
- PowerSync Cloud: create an instance, configure the JWT public key (derived from `POWERSYNC_JWT_SECRET`), and set `NEXT_PUBLIC_POWERSYNC_URL` to the instance URL.

In either case, `PS_JWT_AUDIENCE` must match `NEXT_PUBLIC_POWERSYNC_URL` exactly, and the same `POWERSYNC_JWT_SECRET` must be shared between the Next.js app and the PowerSync service.

### 3. Google OAuth

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- Add your production domain to **Authorised JavaScript origins**: `https://yourdomain.com`
- Add the callback URL to **Authorised redirect URIs**: `https://yourdomain.com/api/auth/callback/google`

### 4. Email

Configure a production SMTP provider and set `EMAIL_SERVER` and `FROM_EMAIL` in Vercel environment variables. [Resend](https://resend.com) works well with the Nodemailer provider.

### 5. Twilio Verify

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and `TWILIO_MESSAGING_SERVICE_SID` in Vercel. The Verify service must have the **SMS** channel enabled. The Messaging Service is used for sending invitation SMS messages.

### 6. Vercel environment variables

Set all of the following in your Vercel project settings (Settings → Environment Variables):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon / Supabase connection string (with `?sslmode=require`) |
| `AUTH_SECRET` | Same secret used locally (or regenerate) |
| `NEXTAUTH_URL` | `https://yourdomain.com` |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `EMAIL_SERVER` | Production SMTP URL |
| `FROM_EMAIL` | Sender address |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service SID |
| `NEXT_PUBLIC_POWERSYNC_URL` | PowerSync instance URL (HTTPS) |
| `POWERSYNC_JWT_SECRET` | Random secret shared with PowerSync |
| `PS_JWT_SECRET_B64URL` | base64url encoding of the secret |
| `PS_JWT_AUDIENCE` | Must match `NEXT_PUBLIC_POWERSYNC_URL` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key (generate with `npx web-push generate-vapid-keys`) |
| `VAPID_PRIVATE_KEY` | VAPID private key |
| `VAPID_SUBJECT` | `mailto:admin@yourdomain.com` |
| `CRON_SECRET` | Random secret for authenticating cron job requests |
| `NEXT_PUBLIC_APP_URL` | `https://yourdomain.com` |
| `QSTASH_TOKEN` | QStash API token (from [Upstash Console](https://console.upstash.com/qstash)) |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key (from Upstash Console) |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key (from Upstash Console) |

### 7. Deploy

Push to your main branch or trigger a deploy from the Vercel dashboard. The build will:
1. Run `prisma migrate deploy` against the production database
2. Generate the Prisma client
3. Build the Next.js app (including compiling the service worker)

## Project Structure

```
src/
├── app/
│   ├── (app)/               # Authenticated app shell
│   │   ├── home/            # Dashboard
│   │   ├── activities/      # Activity management & reporting
│   │   ├── soldiers/        # Soldier roster
│   │   ├── requests/        # Leave, medical & hardship requests workflow
│   │   ├── reports/         # Activity summary, request summary (PDF), Sheets export
│   │   ├── users/           # User management (admin)
│   │   ├── admin/           # Admin panel (cycles, structure, activity types)
│   │   └── profile/         # User profile
│   ├── (public)/            # Unauthenticated pages (login, invite)
│   ├── api/                 # API routes (auth, activities, push, cron, etc.)
│   ├── serwist/[path]/      # Service worker compilation route handler
│   └── sw.ts                # Service worker source (compiled by esbuild)
├── components/              # Shared UI components
├── lib/
│   ├── auth/                # NextAuth config & permissions
│   ├── db/                  # Prisma client
│   ├── api/                 # Server-side helpers (hierarchy, scoping)
│   ├── email/               # Email templates
│   ├── push/                # Web Push notification utilities (VAPID, send)
│   ├── reports/             # Report data fetching and HTML/PDF rendering
│   └── powersync/           # PowerSync schema, connector, database singleton, sync-config.yaml
├── hooks/                   # React hooks (useOnlineStatus, etc.)
└── types/                   # TypeScript type definitions
prisma/
├── schema.prisma            # Database schema
├── migrations/              # Prisma migration history
└── seed.ts                  # Reference data seed
```

## Email Forwarding (AWS SES + Terraform)

This project includes a simple email forwarding setup using AWS SES.

### Overview

Inbound email for a specific address (e.g. `support@sitename.org.il`) is:

1. Received by AWS SES
2. Stored in S3
3. Processed by a Lambda function
4. Forwarded to another email address

The original email is attached to the forwarded message as a `.eml` file.

---

## Configuration

All configuration is defined in `infra/terraform.tfvars`:

```hcl
aws_region       = "us-east-1"
domain_name      = "sitename.org.il"
zone_name        = "sitename.org.il"
recipient_email  = "support@sitename.org.il"
forward_to_email = "your@email.com"
from_email       = "forwarder@sitename.org.il"
bucket_name      = "tironet-inbound-email"
rule_set_name    = "default-inbound"
rule_name        = "forward-support"
s3_prefix        = "inbound"
```

Key variables
* `recipient_email` – the address that receives incoming mail
* `forward_to_email` – where the email is forwarded
* `from_email` – sender used by SES when forwarding (must be verified in SES)
* `aws_region` – must support SES receiving

### Usage
*Initial setup:*
```bash
cd infra
terraform init
terraform plan
terraform apply
```

*Updating*
To change configuration (e.g. forwarding address), update terraform.tfvars and run:
```bash
cd infra
terraform plan
terraform apply
```

## Credits

### Coding
The coding in this app was performed by Claude Code.

### Logos
The [app logo](https://www.svgrepo.com/svg/212751/soldier) and [splash page logo]((https://www.svgrepo.com/svg/212774/running-exercise)) are from SVG Repo.