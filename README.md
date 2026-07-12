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

## Tests

```bash
createdb watchly_test                      # once
npm run db:deploy -w @watchly/api          # once, with DATABASE_URL=…watchly_test
npm test
```

26 integration tests, run against a **real Postgres** rather than mocks — the logic
worth testing (the jsonb provider filter, the 30-day exclusion, mutual-YES
matching) lives in SQL and in Prisma's constraints, so mocking the database would
only test the mocks. The suite refuses to run unless the database name contains
"test", because it truncates every table.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs these plus a real
Metro bundle of the app on every push. The bundle step is the one that earns its
keep: the worst bugs in this project — a duplicate React hoisted to the workspace
root, a `react-native-worklets` build whose native ABI didn't match Expo Go's, a
Metro resolver that couldn't see nested `node_modules` — all typechecked perfectly
and only died at bundle time.

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

## Sessions

Same-device (pass the phone) and multi-device (Socket.io) both work. The title
queue is built **once**, at session creation, and frozen: both people must swipe
the same titles in the same order, and rebuilding it per request would reshuffle
and desync them.

Votes go over REST, not the socket — a vote must persist even if the socket is
down. The socket only *notifies*. That's why a disconnect costs nothing: the
votes are already in Postgres, and reconnecting resumes exactly where you left
off. No socket event ever carries a vote *decision*, only counts; leaking one
would quietly destroy the no-bias mechanic.

The **server** closes a session when the last vote lands. If completion were left
to whoever finishes second, their app dying on the final swipe would strand both
people's votes forever. Sessions idle for 30 minutes are auto-abandoned.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) and [docs/STORE.md](docs/STORE.md).

## Build status

All seven features are built. Verified end-to-end against a real Postgres and
real Socket.io clients: auth + refresh rotation, catalog sync (~4,000 titles),
queue filtering and the 30-day exclusion, session/vote/match logic, multi-device
sync, history, and saved partners. The production build boots and serves.

**Not yet verified, and you can't skip these:**

- **The swipe feel.** Gesture physics, haptics, card springs — written, tuned by
  eye, never felt on a device by anyone but you.
- **Streaming deep links.** These *cannot* work in Expo Go: the
  `LSApplicationQueriesSchemes` / `queries` entries compile into your app's
  manifest, and in Expo Go your JS runs inside Expo Go's binary with Expo Go's
  manifest. `canOpenURL` returns false and every "Play on Netflix" falls through
  to a web search, even with Netflix installed. **Needs a dev build, on a real
  phone.** The spec is blunt that the product fails on its punchline if these
  don't open.
- **Two-phone multi-device.** The backend is verified with two socket clients;
  two actual phones is a different test.
