import { defineConfig } from 'vitest/config';

/**
 * A Homebrew/Postgres.app install creates a superuser named after the OS user, not
 * "postgres" — so hard-coding `postgres@localhost` fails with "denied access" on a
 * stock macOS dev machine. CI sets DATABASE_URL explicitly and never reaches this.
 */
const LOCAL_TEST_DB = `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/watchly_test`;

/**
 * Tests run against a REAL Postgres, not mocks. The logic worth testing here —
 * the jsonb provider filter, the 30-day exclusion, the mutual-YES match — lives in
 * SQL and in Prisma's constraints. Mocking the database would only test the mocks.
 */
export default defineConfig({
  test: {
    // Defaults to the local test database, but CI's env wins. Set here rather than
    // in a .env file because env.ts calls dotenv, and dotenv does NOT override
    // variables that are already set — so anything we put in process.env first
    // takes precedence, which is exactly what we want.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? LOCAL_TEST_DB,
      DIRECT_URL: process.env.DIRECT_URL ?? LOCAL_TEST_DB,
      JWT_ACCESS_SECRET:
        process.env.JWT_ACCESS_SECRET ?? 'test_access_secret_at_least_32_chars_long',
      JWT_REFRESH_SECRET:
        process.env.JWT_REFRESH_SECRET ?? 'test_refresh_secret_at_least_32_chars_lo',
      NODE_ENV: 'test',

      // The production floor (1.8s) is an anti-enumeration control, not logic —
      // paying it on every test signup took the suite from 13s to 86s.
      SIGNUP_TIME_FLOOR_MS: '0',

      // Deliberately blank. The catalogue is lazy — it calls TMDB when the local
      // cache can't satisfy a query — and a test suite that reaches the network is
      // slow, flaky, and dependent on someone else's uptime. With no key,
      // ensureQueue serves only what the test seeded, which is what we want to
      // assert on anyway. Note dotenv does not override already-set variables, so
      // this wins over the real key sitting in .env.
      TMDB_API_KEY: '',
    },

    // One shared database: parallel files would let one suite's TRUNCATE wipe
    // another's fixtures mid-run.
    fileParallelism: false,

    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
