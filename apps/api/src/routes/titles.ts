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
import { parseBody } from '../lib/validate.js';
import type { QueueFilters } from '../lib/queue.js';
import { ensureQueue, getOrFetchTitle, refreshIfIncomplete } from '../lib/catalog.js';
import { lovedGenres } from '../lib/taste.js';

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
      tasteGenres: q.mood ? [] : await lovedGenres(me.id, q.titleType),
      limit: q.limit,
    };

    const titles = await ensureQueue(prisma, filters, [me.id]);

    res.json({
      titles: titles.map(toPublicTitle),
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

    const loved = await lovedGenres(me.id, titleType);

    const base = {
      region,
      services,
      titleType,
      maxRuntime: null,
      minYear: null,
      minRating: null,
      language: null,
      tasteGenres: [] as string[],
      limit: 12,
    } as const;

    let queue = await ensureQueue(prisma, { ...base, genres: loved }, [me.id]);
    if (queue.length === 0) {
      queue = await ensureQueue(prisma, { ...base, genres: [] }, [me.id]);
    }

    if (queue.length === 0) {
      throw ApiError.conflict('EMPTY_QUEUE', 'Nothing to surprise you with right now.');
    }

    res.json({ title: toPublicTitle(queue[0]!) });
  }),
);

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

titlesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    let title = await prisma.title.findUnique({ where: { id: req.params.id } });
    if (!title) throw ApiError.notFound('That title isn’t in the catalogue any more.');
    title = await refreshIfIncomplete(prisma, title, me.region as Region);
    res.json({ title: toDetailedTitle(title) });
  }),
);

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

export function toDetailedTitle(t: Title) {
  return {
    ...toPublicTitle(t),
    overview: t.overview,
    language: t.language,
    backdropUrl: t.backdropUrl,
    topCast: t.topCast as unknown as { name: string; character: string; profileUrl: string | null }[],
    certifications: t.certifications as unknown as Partial<Record<Region, string>>,
    recommendations: t.recommendations as unknown as {
      tmdbId: number;
      type: 'MOVIE' | 'TV';
      title: string;
      posterUrl: string | null;
    }[],
  };
}

const resolveSchema = z.object({
  tmdbId: z.number().int().positive(),
  type: z.enum(['MOVIE', 'TV']),
});

titlesRouter.post(
  '/resolve',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const { tmdbId, type } = parseBody(resolveSchema, req.body);

    const title = await getOrFetchTitle(prisma, tmdbId, type, me.region as Region);
    if (!title) {
      throw ApiError.notFound('Couldn’t find that title.');
    }

    res.json({ title: toDetailedTitle(title) });
  }),
);

export { RECENT_SWIPE_EXCLUSION_DAYS };
