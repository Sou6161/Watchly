import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';

export const app = express();

app.use(cors());
app.use(express.json());

// Render pings this to keep the free-tier instance warm-ish.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Watchly API listening on :${env.PORT} (${env.NODE_ENV})`);
});
