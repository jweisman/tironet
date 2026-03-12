# Tironet — Military Training Management

A web application for managing IDF training cycles: soldiers, activities, attendance reports, and hierarchical command access. Built for use in the field with a mobile-first, Hebrew (RTL) interface.

## Features

- **Training hierarchy** — Cycles → Companies → Platoons → Squads → Soldiers
- **Role-based access** — Admins, cycle commanders, company commanders, platoon commanders, and squad commanders each see only their slice of the hierarchy
- **Activity management** — Create training activities, assign them to platoons, and record per-soldier results (pass / fail / N/A) with optional grades and notes
- **Bulk reporting** — Update an entire squad's activity results in one action
- **Dashboard** — Live summary of activity completion rates, gap counts, and missing reports per platoon/squad
- **Soldier profiles** — Photo upload with in-browser cropping and compression; bulk import from Excel
- **Invitation system** — Admins invite users by email; each invitation scopes the user to a specific unit and role
- **Authentication** — Google OAuth, email magic link (Nodemailer), and WhatsApp OTP (Twilio Verify)
- **Admin panel** — Manage cycles, companies, platoons, squads, activity types, and users

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth | NextAuth v5 (JWT strategy) |
| Database | PostgreSQL via Prisma ORM |
| UI | Tailwind CSS v4, shadcn/ui (Base UI), Lucide icons |
| Internationalisation | next-intl (Hebrew / RTL) |
| Email | Nodemailer (dev: Mailhog; prod: SMTP) |
| OTP | Twilio Verify (WhatsApp / SMS) |
| Image processing | browser-image-compression, react-easy-crop |
| Drag & drop | dnd-kit |
| Excel import | xlsx |
| PWA | @ducanh2912/next-pwa |
| Deployment | Vercel (production), Docker Compose (local dev) |

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
cp .env.example .env.local
```

Edit `.env.local` and fill in the values (see [Environment Variables](#environment-variables) below).

### 3. Start services

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5434` (maps to container port 5432)
- **Mailhog** SMTP on port `1026`, web UI at `http://localhost:8026`

### 4. Run database migrations and seed

```bash
npm run db:migrate   # run Prisma migrations
npm run db:seed      # seed activity types and a sample cycle
```

### 5. Start the dev server

```bash
npm run dev
```

App runs at `http://localhost:3001`.

### 6. Create the first admin user

Sign in with Google or magic link, then run:

```bash
npm run make-admin -- --email you@example.com
```

### Useful dev commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server on port 3001 |
| `npm run db:migrate` | Run pending Prisma migrations |
| `npm run db:seed` | Seed reference data |
| `npm run db:studio` | Open Prisma Studio at localhost:5555 |
| `npm run make-admin -- --email <email>` | Promote a user to admin |
| `npm run build` | Production build (runs migrations + prisma generate) |

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
# PostgreSQL connection string
DATABASE_URL="postgresql://tironet:tironet@127.0.0.1:5434/tironet"

# NextAuth — generate with: openssl rand -base64 32
AUTH_SECRET="..."

# Google OAuth (https://console.cloud.google.com/apis/credentials)
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."

# Email / SMTP
# Dev: Mailhog (started by docker compose)
EMAIL_SERVER="smtp://localhost:1026"
FROM_EMAIL="Tironet <noreply@yourdomain.com>"

# Twilio Verify — for WhatsApp OTP auth
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_VERIFY_SERVICE_SID="..."

# Public app URL (used in invitation emails)
NEXT_PUBLIC_APP_URL="http://localhost:3001"
```

## Production Deployment (Vercel)

### 1. Database

Provision a managed PostgreSQL instance (e.g. [Neon](https://neon.tech) or [Supabase](https://supabase.com)) and obtain a connection string. Enable SSL on the connection.

Prisma migrations run automatically during the Vercel build via the `build` script:
```json
"build": "npx prisma migrate deploy && npx prisma generate && next build"
```

### 2. Google OAuth

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- Add your production domain to **Authorised JavaScript origins**: `https://yourdomain.com`
- Add the callback URL to **Authorised redirect URIs**: `https://yourdomain.com/api/auth/callback/google`

### 3. Email

Configure a production SMTP provider and set `EMAIL_SERVER` and `FROM_EMAIL` in Vercel environment variables. [Resend](https://resend.com) works well with the Nodemailer provider.

### 4. Twilio Verify

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` in Vercel. The Verify service must have the **WhatsApp** or **SMS** channel enabled.

### 5. Vercel environment variables

Set all of the following in your Vercel project settings (Settings → Environment Variables):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon / Supabase connection string (with `?sslmode=require`) |
| `AUTH_SECRET` | Same secret used locally (or regenerate) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `EMAIL_SERVER` | Production SMTP URL |
| `FROM_EMAIL` | Sender address |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service SID |
| `NEXT_PUBLIC_APP_URL` | `https://yourdomain.com` |

### 6. Deploy

Push to your main branch or trigger a deploy from the Vercel dashboard. The build will:
1. Run `prisma migrate deploy` against the production database
2. Generate the Prisma client
3. Build the Next.js app

## Project Structure

```
src/
├── app/
│   ├── (app)/               # Authenticated app shell
│   │   ├── home/            # Dashboard
│   │   ├── activities/      # Activity management & reporting
│   │   ├── soldiers/        # Soldier roster
│   │   ├── users/           # User management (admin)
│   │   ├── admin/           # Admin panel (cycles, structure, activity types)
│   │   └── profile/         # User profile
│   ├── (public)/            # Unauthenticated pages (login, invite)
│   └── api/                 # API routes (auth, activities, soldiers, etc.)
├── components/              # Shared UI components
├── lib/
│   ├── auth/                # NextAuth config & permissions
│   ├── db/                  # Prisma client
│   ├── api/                 # Server-side helpers (hierarchy, scoping)
│   └── email/               # Email templates
├── hooks/                   # React hooks
└── types/                   # TypeScript type definitions
prisma/
├── schema.prisma            # Database schema
├── migrations/              # Prisma migration history
└── seed.ts                  # Reference data seed
```
