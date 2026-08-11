import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { ApiError, wrap } from '../lib/errors.js';
import { syncCatalog } from '../jobs/sync-catalog.js';

export const internalRouter = Router();

/** Tracks the running sync so a second trigger can't start a concurrent one. */
let syncRunning = false;

internalRouter.post(
  '/sync-catalog',
  wrap(async (req, res) => {
    if (!env.CRON_SECRET) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'CRON_SECRET is not set on this instance.');
    }

    const presented = req.header('x-cron-secret') ?? '';
    const a = Buffer.from(presented);
    const b = Buffer.from(env.CRON_SECRET);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw ApiError.unauthorized('Bad cron secret.');
    }

    if (syncRunning) {
      res.status(409).json({ error: { code: 'ALREADY_RUNNING', message: 'Sync already running.' } });
      return;
    }

    syncRunning = true;
    res.status(202).json({ started: true });

    try {
      const result = await syncCatalog();
      console.log('Nightly sync:', result);
    } catch (err) {
      console.error('Nightly sync failed:', err);
    } finally {
      syncRunning = false;
    }
  }),
);
