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

## Build status

Feature 1 (auth + onboarding) is done. Features 2–7 (catalog sync, swipe,
multi-device, results, history, polish) are not built yet.
