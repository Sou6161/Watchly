import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { initRealtime } from './realtime.js';
import { startAbandonmentSweep } from './jobs/abandon-stale.js';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { titlesRouter } from './routes/titles.js';
import { internalRouter } from './routes/internal.js';
import { sessionsRouter } from './routes/sessions.js';

export const app = express();

app.use(cors());
app.use(express.json());

// Render pings this to keep the free-tier instance warm-ish.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/titles', titlesRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/internal', internalRouter);

app.use(errorHandler);

// Socket.io shares the Express HTTP server rather than binding its own port —
// Render's free tier only exposes one.
const httpServer = createServer(app);
initRealtime(httpServer);
startAbandonmentSweep();

httpServer.listen(env.PORT, () => {
  console.log(`Watchly API listening on :${env.PORT} (${env.NODE_ENV})`);
});
