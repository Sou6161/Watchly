import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { ApiError, wrap } from '../lib/errors.js';
import { syncCatalog } from '../jobs/sync-catalog.js';

export const internalRouter = Router();

/** Tracks the running sync so a second trigger can't start a concurrent one. */
let syncRunning = false;

/**
 * POST /internal/sync-catalog
 *
 * The nightly catalog refresh, triggered externally (see
 * .github/workflows/sync-catalog.yml).
 *
 * Not an in-process cron: Render's free tier spins the instance down after ~15
 * minutes of inactivity, so a `node-cron` timer would simply never fire on a
 * sleeping dyno at 3am. An external scheduler that makes an HTTP request both
 * wakes the instance and runs the job.
 */
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
      // A sync takes many minutes. Overlapping runs would double every TMDB
      // request for no benefit.
      res.status(409).json({ error: { code: 'ALREADY_RUNNING', message: 'Sync already running.' } });
      return;
    }

    // The sync outlives any sane HTTP timeout, so acknowledge now and run
    // detached. The scheduler only needs to know we accepted the job.
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
