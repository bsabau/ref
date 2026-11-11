# REF 2026 — Rockstadt Extreme Fest Companion

Progressive web app for **Rockstadt Extreme Fest 2026** (12th Edition · 27–31 July 2026 · Ghimbav, Romania): full 5-day timetable across all three stages, personal to-see lists with clash detection, band pages with recent setlists, offline support, and 15-minute Web Push reminders before starred sets start.

## Features

- **5-day festival timetable** across *Adrian Rugina Stage*, *Brasov Stage*, and *Andrei Calmuc Stage*, defaulting to the current festival day.
- **Search by band or genre** across all days, or tap any genre chip on a band page to filter the lineup.
- **Personal "My list" & clash detection** — star sets from the timetable or band pages; overlapping starred sets are automatically flagged (`⚠ clash`) with the conflicting band and time window.
- **Band detail pages** (`/band/[slug]`) — local artist photo, country, clickable genre chips, stage/slot link back to the timetable, biography, social links, and a collapsible **Last show setlist** sourced from [setlist.fm](https://www.setlist.fm/).
- **Offline-first PWA** — installable to the home screen with a service worker (`public/sw.js`) that caches visited pages and static assets, pre-warms starred bands' pages and photos in the background, and queues offline star/unstar actions in `localStorage` (`lib/pendingFavorites.ts`) to replay idempotently when connectivity returns.
- **Web Push set reminders** — per-device ON/OFF switch in the top bar (with iOS Safari "Add to Home Screen" guidance) that sends a push notification 15 minutes before any starred band goes on stage.
- **Lightweight friends-only sign-in** — enter a name to load or create a profile (capped at 50 users), backed by an HMAC-SHA256 signed `HttpOnly` session cookie.

## Stack

- **Framework:** Next.js 16 (App Router) & React 19
- **Language & Styling:** TypeScript, Tailwind CSS v4, custom festival theme (`app/globals.css`)
- **Database:** Neon Serverless Postgres (`@neondatabase/serverless`)
- **Notifications:** Web Push (`web-push` + Service Worker Push API), triggered by GitHub Actions (`.github/workflows/notify.yml`)

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```sh
cp .env.example .env.local
```

```dotenv
DATABASE_URL=postgres://...
SESSION_SECRET=
CRON_SECRET=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
# Optional: setlist.fm API key for scripts/fetch-setlists.mjs
# (free, https://api.setlist.fm — falls back to polite scraping without it)
SETLISTFM_API_KEY=
```

Generate the secrets and VAPID key pair with:

```sh
openssl rand -base64 32                  # use for SESSION_SECRET (min 16 chars)
openssl rand -base64 32                  # use for CRON_SECRET (min 16 chars)
npx web-push generate-vapid-keys         # outputs NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
```

For scheduled push notifications via `.github/workflows/notify.yml`, configure `CRON_SECRET` and `APP_URL` (e.g. `https://your-deployment.vercel.app`) as GitHub Actions repository secrets.

## Run locally

Requires Node.js `>=20.9.0` and a Postgres database (e.g. [Neon](https://neon.tech)).

```sh
npm install
node scripts/seed.mjs            # creates tables and seeds stages, artists.json, and lineup.json
node scripts/fetch-setlists.mjs  # optional: fetches each artist's latest setlist from setlist.fm
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Description |
|---|---|
| `node scripts/seed.mjs` | Creates the Postgres schema (`stages`, `artists`, `performances`, `users`, `favorites`, `push_subscriptions`, `notifications_sent`, `artist_setlists`) and upserts the 3 stages, 87 artists (`artists.json`), and 85 performances (`lineup.json`). Safe to re-run. |
| `node scripts/fetch-setlists.mjs [--force] [--only=<slug>] [--limit=N]` | Fetches each artist's most recent past show with songs from setlist.fm (via the official API when `SETLISTFM_API_KEY` is set, or polite scraping otherwise) and stores it in `artist_setlists`. |
| `node scripts/update-schedule-2026-07-23.mjs` | One-off transactional migration for the 2026-07-23 timetable revision (2 cancellations, 9 slot moves) on an already-seeded database. |

## Repository layout

| Path | Description |
|---|---|
| `app/` | Next.js App Router pages (`/`, `/login`, `/band/[slug]`, `/offline`) and API routes (`/api/login`, `/api/logout`, `/api/favorites`, `/api/push/subscribe`, `/api/cron/notify`) |
| `components/` | Client components: `Timetable`, `StarButton`, `PushToggle`, `LoginForm`, `ServiceWorkerRegistrar` |
| `lib/` | Neon database queries (`db.ts`), HMAC session cookies (`auth.ts`), CSRF/JSON guards (`security.ts`), and offline favorite queue (`pendingFavorites.ts`) |
| `public/` | Service worker (`sw.js`), Web App Manifest (`manifest.json`), icons, and artist photos (`public/images/`) |
| `lineup.json`, `artists.json` | Festival schedule and artist metadata/biographies |
| `audits/security_audit.md` | Application security audit (all findings remediated in commit `85535a2`) |
