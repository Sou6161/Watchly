# Watchly

Two people, fifteen trailers, one decision. Swipe through trailers together, see
what you both said yes to, press play.

Deciding what to watch is the fight before the film. Watchly turns it into a
thirty-second game: you each swipe a shared deck of trailers, and the app shows
you only the titles you *both* wanted — then deep-links straight into the app that
streams it. India-first (JioHotstar, Prime, Netflix, Sony LIV, and more), with the
US along for the ride.

## Layout

```
apps/api        Express + Prisma + Postgres
apps/mobile     Expo (SDK 54) + expo-router
packages/shared TS types, enums, and the streaming-service catalog used by both
```

`packages/shared` is consumed as **TypeScript source** — no build step. It is the
single place that defines the session/vote enums, the mood → genre maps, and the
streaming-service list, so the client and server physically cannot drift out of
sync. Change a vote decision or a provider id in one place and both sides get it.

## Setup

```bash
npm install                              # one root install covers all workspaces

cp apps/api/.env.example apps/api/.env    # then fill it in
npm run db:push                           # create tables
```

`.env` needs a Postgres URL (Neon in prod, local Postgres is fine for dev), a TMDB
key, and two **different** JWT secrets — generate each with `openssl rand -hex 32`.
The API refuses to boot if the secrets match or are missing. Nothing sensitive
lives in this repo; see `apps/api/.env.example` for the full list of variable
names.

## Running

```bash
npm run api      # :4000
npm run mobile   # Expo
```

Testing on a **physical device**: `localhost` points at the phone, not your Mac.
Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your machine's LAN address
(e.g. `http://192.168.1.5:4000`).

## Tests

```bash
createdb watchly_test                      # once
npm run db:deploy -w @watchly/api          # once, against DATABASE_URL=…watchly_test
npm test
```

**61 integration tests**, run against a **real Postgres** rather than mocks — the
logic worth testing (the jsonb provider filter, the 30-day exclusion, mutual-YES
matching, the taste-weighted shuffle) lives in SQL and in Prisma's constraints, so
mocking the database would only test the mocks. The suite refuses to run unless the
database name contains "test", because it truncates every table.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs these plus a real
Metro bundle of the app on every push. The bundle step is the one that earns its
keep: the worst bugs in this project — a duplicate React hoisted to the workspace
root, a `react-native-worklets` build whose native ABI didn't match Expo Go's, a
Metro resolver that couldn't see nested `node_modules` — all typechecked perfectly
and only died at bundle time.

## Auth

Email/password, bcrypt (12 rounds). 15-minute access JWT + 30-day refresh JWT with
a distinct secret per token family and a random `jti` per token, so a refresh
genuinely rotates rather than re-minting an identical string. Only a SHA-256 of the
refresh token is stored, so a DB leak can't be replayed; refresh rotates on every
use, and logout nulls the hash to revoke. Tokens live in Expo SecureStore. The
mobile client refreshes on 401 transparently and single-flights concurrent
refreshes so parallel requests can't invalidate each other's token. Signup is
constant-time to avoid leaking which emails are registered.

## Catalog

The catalog is **lazy and write-through**. When a session needs a deck, the API
asks TMDB `/discover` for exactly the caller's filters (region, their services'
provider ids, mood genres, runtime, era, rating, language), caches whatever's new
in Postgres, and serves from there. A returning user with a warm cache typically
pays for only the two or three titles that are genuinely new since last time.

Two rules drop a title on the way in, because both would make a dead card:

- **No trailer, no card.** TMDB has no "has a trailer" filter and ~half of titles
  don't have one, so we over-fetch and cull after checking `/videos`.
- **No provider, no card.** If nobody streams it on a service the user pays for,
  it can never be actioned.

TMDB assigns the same service different provider ids per region (Prime Video is 119
in India, 9 in the US), so `STREAMING_SERVICES` keys them by region. A few services
are split across ids TMDB never merged — Paramount+ into Premium/Essential, Peacock
into Premium/Premium Plus — so a service can own **several** ids and we map all of
them, or the filter silently misses titles. Seventeen services are wired for India
and the US; verify every id against the live API any time:

```bash
npm run tmdb:providers -w @watchly/api
```

> Hotstar and JioCinema merged into **JioHotstar** in 2025. TMDB dropped the old
> ids, so the two are one service (`hotstar`) here.

A nightly warm-up ([.github/workflows/sync-catalog.yml](.github/workflows/sync-catalog.yml))
POSTs to `/internal/sync-catalog` to keep popular titles fresh — GitHub Actions
rather than an in-process timer, because Render's free tier sleeps after ~15 min
idle and a timer would never fire at 3am on a sleeping instance. The POST both
wakes the instance and runs the job; it needs `API_URL` and `CRON_SECRET` as
Actions secrets, `CRON_SECRET` matching the API's env.

### The deck, and adaptive taste

A session's fifteen titles are drawn with a **popularity-weighted shuffle**
(Efraimidis–Spirakis: `ORDER BY -ln(random()) / weight`). A plain `random()` over
thousands of titles surfaces mostly obscure ones; ordering by popularity alone
shows the same fifteen every night. The weighted draw gives a fresh deck that still
leans recognisable.

On top of that, the deck **adapts to you**. When you don't pick a specific mood,
titles that share the genres you keep saying yes to get their shuffle weight
multiplied — so the app visibly gets more "you" the more you use it, while horror
still shows up for the thriller lover, because it's a bias, not a filter. A chosen
mood is an explicit override and turns the bias off. A brand-new account with no
history sees the plain popularity shuffle.

## Sessions

Three ways to play, one vote model underneath:

- **Same-device** — pass the phone; person A swipes, then person B.
- **Live multi-device** — two phones, Socket.io-synced, swiping at once.
- **Async** — person A swipes now and shares a code; person B finishes hours or
  days later. Same two-account model, only the timing differs.

The title queue is built **once**, at creation, and frozen: both people must swipe
the same titles in the same order, and rebuilding it per request would reshuffle
and desync them.

Votes go over **REST, not the socket** — a vote must persist even if the socket is
down. The socket only *notifies*. That's why a disconnect costs nothing: the votes
are already in Postgres, and reconnecting resumes exactly where you left off. No
socket event ever carries a vote *decision*, only counts; leaking one would quietly
destroy the no-peeking mechanic.

The **server** closes a session when the last vote lands. If completion were left
to whoever finishes second, their app dying on the final swipe would strand both
people's votes forever. Live sessions idle for 30 minutes are auto-abandoned; async
sessions get a week, because sitting untouched is the whole point.

## Beyond the swipe

The core loop is auth → onboarding → session → results → play. Around it:

- **Near-miss tiebreaker.** A zero-match night isn't a dead end — the results
  screen surfaces titles one of you liked (ranked by how close the other was) so
  you can break the tie instead of walking away empty.
- **Watch-loop.** The morning after a match, a one-tap "did you watch it?" closes
  the loop — the only signal that says the app actually did its job.
- **Taste profile.** How in-sync you two are (of everything either liked, how much
  you both did), your loved genres, nights watched, a week-streak, and a
  **shareable sync card** rendered to an image — the app's cheapest growth loop.
- **On the fence.** Every title you swiped *maybe* on, gathered into a shortlist.
- **Surprise us.** One taste-biased pick, no swiping, for the lazy nights.
- **History.** All your past nights on their own screen, filterable by kind and
  mode, paginated so it never becomes an endless scroll.
- **Session rules.** Mood, era, quality floor, language, runtime, and deck size —
  each threaded through both the TMDB fetch and the SQL so the deck is genuinely
  filtered, not just trimmed after the fact.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) and [docs/STORE.md](docs/STORE.md). Backend on
Render, Postgres on Neon, mobile shipped as an Android build via EAS.

## Verify on a real device

Two things genuinely cannot be checked from a laptop, and both matter:

- **Streaming deep links.** They *cannot* work in Expo Go: the
  `queries` / `LSApplicationQueriesSchemes` entries compile into your app's
  manifest, but in Expo Go your JS runs inside Expo Go's binary with Expo Go's
  manifest, so `canOpenURL` returns false and every "Play on Netflix" falls through
  to a web search — even with Netflix installed. **Needs a dev/release build on a
  real phone.** The share card (`react-native-view-shot`) is the same story.
- **The swipe feel.** Gesture physics, haptics, and card springs are tuned by eye;
  they have to be felt on a device.
