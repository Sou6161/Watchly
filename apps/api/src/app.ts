import cors from 'cors';
import express from 'express';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { titlesRouter } from './routes/titles.js';
import { internalRouter } from './routes/internal.js';
import { sessionsRouter } from './routes/sessions.js';
import { apiLimiter, authLimiter, signupLimiter } from './middleware/rateLimit.js';

export function createApp({ rateLimit = true }: { rateLimit?: boolean } = {}) {
  const app = express();

  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  const auth = rateLimit ? [authLimiter] : [];
  const general = rateLimit ? [apiLimiter] : [];
  // Signup gets its own, stricter bucket — see the note on signupLimiter.
  const signup = rateLimit ? [signupLimiter] : [];

  if (signup.length > 0) app.use('/api/auth/signup', ...signup);
  app.use('/api/auth', ...auth, authRouter);
  app.use('/api/me', ...general, meRouter);
  app.use('/api/titles', ...general, titlesRouter);
  app.use('/api/sessions', ...general, sessionsRouter);
  app.use('/internal', internalRouter);

  app.use(errorHandler);

  return app;
}
