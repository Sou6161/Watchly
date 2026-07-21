import { Router } from 'express';
import { z } from 'zod';
import type { Title } from '@prisma/client';
import {
  ERA_FILTERS,
  LANGUAGE_FILTERS,
  MOOD_IDS,
  RATING_FILTERS,
  RECENT_SWIPE_EXCLUSION_DAYS,
  REGIONS,
  SERVICE_IDS,
  languageCodeForId,
  minRatingForId,
  minYearForEra,
  moodById,
  type Region,
} from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import type { QueueFilters } from '../lib/queue.js';
import { ensureQueue } from '../lib/catalog.js';

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
  titleType: z.enum(['MOVIE', 'TV']).default('MOVIE'),
  mood: z.enum(MOOD_IDS as [string, ...string[]]).optional(),
  maxRuntime: z.coerce.number().int().positive().max(600).optional(),
  era: z.enum(ERA_FILTERS.map((e) => e.id) as [string, ...string[]]).optional(),
  rating: z.enum(RATING_FILTERS.map((r) => r.id) as [string, ...string[]]).optional(),
  language: z.enum(LANGUAGE_FILTERS.map((l) => l.id) as [string, ...string[]]).optional(),
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
      titleType: q.titleType,
      genres: q.mood ? (moodById(q.mood)?.genres[q.titleType] ?? []) : [],
      maxRuntime: q.titleType === 'MOVIE' ? (q.maxRuntime ?? null) : null,
      minYear: q.era ? minYearForEra(q.era) : null,
      minRating: q.rating ? minRatingForId(q.rating) : null,
      language: q.language ? languageCodeForId(q.language) : null,
      limit: q.limit,
    };

    const titles = await ensureQueue(prisma, filters, [me.id]);

    res.json({
      titles: titles.map(toPublicTitle),
      // Lets the client tell "no matches for these filters" apart from "we only
      // found 6" — different empty states, different copy.
      exhausted: titles.length < q.limit,
      filters: {
        region,
        services,
        titleType: q.titleType,
        mood: q.mood ?? null,
        maxRuntime: filters.maxRuntime,
      },
    });
  }),
);

/**
 * GET /api/titles/surprise — one pick, no swiping.
 *
 * For the nights when fifteen trailers is too much work. We bias the deck toward
 * the genres this person actually says yes to (from their history), then let the
 * queue's own popularity-weighted shuffle choose — so it's a fresh, plausible
 * "just tell us what to watch" answer rather than the single most popular title
 * every time. Falls back to an unbiased pick for someone with no history yet.
 */
titlesRouter.get(
  '/surprise',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const titleType = req.query.titleType === 'TV' ? 'TV' : 'MOVIE';
    const region = me.region as Region;
    const services = me.services;

    if (services.length === 0) {
      throw ApiError.badRequest('Pick at least one streaming service first.');
    }

    // The genres this person leans toward, for THIS media type (movie and TV use
    // different genre vocabularies, so mixing them would filter with nonsense).
    const loved = await lovedGenres(me.id, titleType);

    const base = {
      region,
      services,
      titleType,
      maxRuntime: null,
      minYear: null,
      minRating: null,
      language: null,
      limit: 12,
    } as const;

    // Try taste-biased first; if that narrows to nothing, fall back to anything
    // watchable so "surprise us" always returns something.
    let queue = await ensureQueue(prisma, { ...base, genres: loved }, [me.id]);
    if (queue.length === 0) {
      queue = await ensureQueue(prisma, { ...base, genres: [] }, [me.id]);
    }

    if (queue.length === 0) {
      throw ApiError.conflict('EMPTY_QUEUE', 'Nothing to surprise you with right now.');
    }

    // The queue is already popularity-weighted-shuffled, so the top item IS a
    // fresh-but-recognisable pick. No extra randomness needed.
    res.json({ title: toPublicTitle(queue[0]!) });
  }),
);

/**
 * GET /api/titles/watchlist — the "on the fence" pile.
 *
 * Every title the caller personally said MAYBE to, across all their nights, most
 * recent first. MAYBE was the one swipe with nowhere to go — not a match, not a
 * no — so collecting it turns hesitation into a list worth coming back to, with
 * zero new save action to learn.
 */
titlesRouter.get(
  '/watchlist',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;

    const votes = await prisma.vote.findMany({
      where: {
        decision: 'MAYBE',
        session: { OR: [{ personAId: me.id }, { personBId: me.id }] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        titleId: true,
        voter: true,
        session: { select: { personAId: true } },
        title: true,
      },
    });

    // Only the caller's OWN maybes (in same-device nights this account also casts
    // the guest's votes), deduped to the most recent occurrence of each title.
    const seen = new Set<string>();
    const titles = [];
    for (const v of votes) {
      const mySide = v.session.personAId === me.id ? 'PERSON_A' : 'PERSON_B';
      if (v.voter !== mySide) continue;
      if (seen.has(v.titleId)) continue;
      seen.add(v.titleId);
      titles.push(toPublicTitle(v.title));
    }

    res.json({ titles });
  }),
);

/** The genres a user says YES to most, for one media type. Empty if no history. */
async function lovedGenres(userId: string, titleType: 'MOVIE' | 'TV'): Promise<string[]> {
  const votes = await prisma.vote.findMany({
    where: {
      decision: 'YES',
      title: { type: titleType },
      session: { OR: [{ personAId: userId }, { personBId: userId }] },
    },
    select: {
      voter: true,
      title: { select: { genres: true } },
      session: { select: { personAId: true } },
    },
  });

  const counts = new Map<string, number>();
  for (const v of votes) {
    // Only the account holder's own side counts as their taste (in same-device
    // sessions this one account also casts the guest's votes).
    const mySide = v.session.personAId === userId ? 'PERSON_A' : 'PERSON_B';
    if (v.voter !== mySide) continue;
    for (const g of v.title.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
}

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
    trailerYoutubeIds: t.trailerYoutubeIds,
    genres: t.genres,
    releaseYear: t.releaseYear,
    runtime: t.runtime,
    rating: t.rating,
    watchProviders: t.watchProviders,
  };
}

export { RECENT_SWIPE_EXCLUSION_DAYS };
