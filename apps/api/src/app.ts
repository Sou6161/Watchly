import cors from 'cors';
import express from 'express';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { titlesRouter } from './routes/titles.js';
import { internalRouter } from './routes/internal.js';
import { sessionsRouter } from './routes/sessions.js';
import { apiLimiter, authLimiter, signupLimiter } from './middleware/rateLimit.js';

/**
 * The Express app, with no server attached.
 *
 * Kept separate from index.ts so tests can drive it in-process (supertest) without
 * binding a port or starting the socket server and the abandonment sweep — a test
 * suite that has to boot the whole world is a test suite nobody runs.
 */
export function createApp({ rateLimit = true }: { rateLimit?: boolean } = {}) {
  const app = express();

  // Render terminates TLS at its proxy and forwards over HTTP. Without this,
  // req.ip is the proxy's address — which would make the rate limiter key every
  // request to the same IP and let one attacker throttle everybody.
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  /**
   * Render polls this to decide the instance is live, and the keep-warm cron pings
   * it every 10 minutes (see docs/DEPLOY.md).
   *
   * It makes NO database query, on purpose, for two reasons: a Neon hiccup would
   * otherwise fail the health check and make Render cycle the instance — taking
   * live sessions and sockets with it; and because it never wakes Neon, the
   * keep-warm ping costs zero Neon compute hours.
   */
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  // Auth gets the strict limiter (brute force + bcrypt is expensive for *us*);
  // everything else gets a blunt ceiling. /health is above both — throttling it
  // would make Render think the instance is dead.
  //
  // Disabled in tests: a suite that runs 20 logins would start 429ing itself, and
  // the resulting failures would look like real bugs.
  const auth = rateLimit ? [authLimiter] : [];
  const general = rateLimit ? [apiLimiter] : [];
  // Signup gets its own, stricter bucket — see the note on signupLimiter.
  const signup = rateLimit ? [signupLimiter] : [];

  // Mounted conditionally: with rate limiting off (tests) this array is empty, and
  // app.use(path) with no middleware makes Express throw.
  if (signup.length > 0) app.use('/api/auth/signup', ...signup);
  app.use('/api/auth', ...auth, authRouter);
  app.use('/api/me', ...general, meRouter);
  app.use('/api/titles', ...general, titlesRouter);
  app.use('/api/sessions', ...general, sessionsRouter);
  app.use('/internal', internalRouter);

  app.use(errorHandler);

  return app;
}
