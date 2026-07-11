import { Router } from 'express';
import { z } from 'zod';
import type { Title } from '@prisma/client';
import {
  MOOD_IDS,
  RECENT_SWIPE_EXCLUSION_DAYS,
  REGIONS,
  SERVICE_IDS,
  moodById,
  type Region,
} from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { buildQueue, type QueueFilters } from '../lib/queue.js';

export const titlesRouter = Router();

titlesRouter.use(requireAuth);

const querySchema = z.object({
  region: z.enum(REGIONS).optional(),
  // Repeatable (?services=netflix&services=prime) or comma-separated.
  services: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const list = Array.isArray(v) ? v : v.split(',');
      return list.map((s) => s.trim()).filter(Boolean);
    }),
  mood: z.enum(MOOD_IDS as [string, ...string[]]).optional(),
  maxRuntime: z.coerce.number().int().positive().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

/**
 * GET /api/titles/queue
 *
 * The candidate pool a session is dealt from. Defaults to the caller's own
 * region and services, so the common case needs no query params at all.
 */
titlesRouter.get(
  '/queue',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.badRequest('Bad queue filters.');
    }
    const q = parsed.data;

    const region: Region = q.region ?? (me.region as Region);
    const services = q.services ?? me.services;

    const unknown = services.filter((s) => !SERVICE_IDS.includes(s));
    if (unknown.length > 0) {
      throw ApiError.badRequest(`Unknown services: ${unknown.join(', ')}.`);
    }
    if (services.length === 0) {
      throw ApiError.badRequest('Pick at least one streaming service first.');
    }

    const filters: QueueFilters = {
      region,
      services,
      genres: q.mood ? (moodById(q.mood)?.genres ?? []) : [],
      maxRuntime: q.maxRuntime ?? null,
      limit: q.limit,
    };

    const titles = await buildQueue(prisma, filters, [me.id]);

    res.json({
      titles: titles.map(toPublicTitle),
      // Lets the client tell "no matches for these filters" apart from "we only
      // found 6" — different empty states, different copy.
      exhausted: titles.length < q.limit,
      filters: { region, services, mood: q.mood ?? null, maxRuntime: filters.maxRuntime },
    });
  }),
);

/**
 * The card payload. Deliberately omits `overview` — the spec forbids plot
 * synopses on cards, and the surest way to honour that is to never ship them.
 */
export function toPublicTitle(t: Title) {
  return {
    id: t.id,
    tmdbId: t.tmdbId,
    type: t.type,
    title: t.title,
    posterUrl: t.posterUrl,
    trailerYoutubeId: t.trailerYoutubeId,
    genres: t.genres,
    releaseYear: t.releaseYear,
    runtime: t.runtime,
    rating: t.rating,
    watchProviders: t.watchProviders,
  };
}

export { RECENT_SWIPE_EXCLUSION_DAYS };
