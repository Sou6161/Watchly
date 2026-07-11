# Watchly

Swipe through trailers together, see what you both said yes to, press play.

## Layout

```
apps/api        Express + Prisma + Postgres
apps/mobile     Expo (SDK 57) + expo-router
packages/shared TS types, enums, and the streaming-service catalog used by both
```

`packages/shared` is consumed as TypeScript source — no build step. It is the one
place that defines session/vote enums and the streaming-service list, so the
client and server can't drift.

## Setup

```bash
npm install

cp apps/api/.env.example apps/api/.env   # then fill it in
npm run db:push                          # create tables
```

`.env` needs a Postgres URL (Neon in prod, local Postgres is fine for dev) and two
**different** JWT secrets — generate with `openssl rand -hex 32`. The API refuses
to boot if they match or are missing.

## Running

```bash
npm run api      # :4000
npm run mobile   # Expo
```

Testing on a **physical device**: `localhost` points at the phone, not your Mac.
Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your machine's LAN address
(e.g. `http://192.168.1.5:4000`).

## Auth

Email/password, bcrypt (12 rounds). 15-minute access JWT + 30-day refresh JWT.
Only a SHA-256 of the refresh token is stored, so a DB leak can't be replayed;
refresh rotates on every use, and logout nulls the hash to revoke. Tokens live in
Expo SecureStore. The mobile API client refreshes on 401 transparently and
single-flights concurrent refreshes so parallel requests can't invalidate each
other's token.

## Catalog

`npm run sync -w @watchly/api` pulls popular + trending movies and TV for IN and
US from TMDB, resolves watch providers, and caches the result. Titles with **no
trailer** or **no streaming provider** are dropped — a card you can't play a
trailer for is a dead card. `SYNC_PAGES=10 npm run sync -w @watchly/api` does a
fast partial run for local work.

TMDB assigns the same service different provider ids per region (Prime Video is
119 in India, 9 in the US), so `STREAMING_SERVICES` keys them by region. Verify
them any time against the live API:

```bash
npm run tmdb:providers -w @watchly/api
```

Note: Hotstar and JioCinema merged into **JioHotstar** in 2025. TMDB has no
JioCinema provider any more, so the two are one service (`hotstar`) here.

### Nightly refresh

Not an in-process cron: Render's free tier sleeps after ~15 min idle, so a timer
would never fire at 3am on a sleeping instance. Instead
`.github/workflows/sync-catalog.yml` POSTs to `/internal/sync-catalog` nightly,
which both wakes the instance and runs the job. Needs `API_URL` and `CRON_SECRET`
as GitHub Actions secrets, with `CRON_SECRET` matching the API's env.

## Build status

Features 1 (auth + onboarding) and 2 (catalog sync + queue) are done. Features
3–7 (swipe, multi-device, results, history, polish) are not built yet.
