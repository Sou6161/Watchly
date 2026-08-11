import { Router } from 'express';
import { z } from 'zod';
import type { Session } from '@prisma/client';
import {
  DECK_SIZES,
  ERA_FILTERS,
  LANGUAGE_FILTERS,
  MOOD_IDS,
  NEAR_MISS_LIMIT,
  RATING_FILTERS,
  REGIONS,
  SERVICE_IDS,
  SESSION_QUEUE_SIZE,
  WATCH_CHECK_MIN_AGE_HOURS,
  WATCH_CHECK_WINDOW_DAYS,
  languageCodeForId,
  minRatingForId,
  minYearForEra,
  moodById,
  type Decision,
  type Region,
  type SessionSummary,
  type Voter,
} from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { parseBody } from '../lib/validate.js';
import { generateSessionCode } from '../lib/code.js';
import { ensureQueue } from '../lib/catalog.js';
import { lovedGenres } from '../lib/taste.js';
import { toPublicTitle } from './titles.js';
import { emitSessionCompleted, emitSessionJoined, emitVoteSubmitted } from '../realtime.js';

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth);

const ERA_IDS = ERA_FILTERS.map((e) => e.id) as [string, ...string[]];
const RATING_IDS = RATING_FILTERS.map((r) => r.id) as [string, ...string[]];
const LANGUAGE_IDS = LANGUAGE_FILTERS.map((l) => l.id) as [string, ...string[]];

const createSchema = z.object({
  mode: z.enum(['SAME_DEVICE', 'MULTI_DEVICE']),
  // Movie night or series night. Required — the client asks before anything else.
  titleType: z.enum(['MOVIE', 'TV']),
  mood: z.enum(MOOD_IDS as [string, ...string[]]).nullish(),
  maxRuntime: z.number().int().positive().max(600).nullish(),
  era: z.enum(ERA_IDS).optional(),
  rating: z.enum(RATING_IDS).optional(),
  language: z.enum(LANGUAGE_IDS).optional(),
  deckSize: z
    .number()
    .int()
    .refine((n) => (DECK_SIZES as readonly number[]).includes(n), 'Unsupported deck size.')
    .optional(),
  region: z.enum(REGIONS).optional(),
  services: z.array(z.enum(SERVICE_IDS as [string, ...string[]])).optional(),
  // Same-device only: the two names typed at session start.
  personALabel: z.string().trim().min(1).max(24).optional(),
  personBLabel: z.string().trim().min(1).max(24).optional(),
  async: z.boolean().optional(),
});

sessionsRouter.post(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const body = parseBody(createSchema, req.body);

    const region: Region = body.region ?? (me.region as Region);
    const services = body.services ?? me.services;
    const isAsync = body.mode === 'MULTI_DEVICE' && body.async === true;

    if (services.length === 0) {
      throw ApiError.badRequest('Pick at least one streaming service first.');
    }

    const deckSize = body.deckSize ?? SESSION_QUEUE_SIZE;

    const tasteGenres = body.mood ? [] : await lovedGenres(me.id, body.titleType);

    const titles = await ensureQueue(
      prisma,
      {
        region,
        services,
        titleType: body.titleType,
        genres: body.mood ? (moodById(body.mood)?.genres[body.titleType] ?? []) : [],
        // Ignored for series — runtime is per-episode there, so a cap is meaningless.
        maxRuntime: body.titleType === 'MOVIE' ? (body.maxRuntime ?? null) : null,
        minYear: body.era ? minYearForEra(body.era) : null,
        minRating: body.rating ? minRatingForId(body.rating) : null,
        language: body.language ? languageCodeForId(body.language) : null,
        tasteGenres,
        limit: deckSize,
      },
      [me.id],
    );

    if (titles.length === 0) {
      throw ApiError.conflict(
        'EMPTY_QUEUE',
        "Nothing matches those filters right now. Try a different mood, or add a service.",
      );
    }

    const session = await prisma.session.create({
      data: {
        code: await generateSessionCode(prisma),
        mode: body.mode,
        isAsync,
        status: body.mode === 'SAME_DEVICE' || isAsync ? 'IN_PROGRESS' : 'WAITING',
        personAId: me.id,
        personALabel: body.personALabel ?? me.displayName,
        personBLabel: body.personBLabel ?? 'Person B',
        region,
        services,
        titleType: body.titleType,
        mood: body.mood ?? null,
        maxRuntime: body.titleType === 'MOVIE' ? (body.maxRuntime ?? null) : null,
        titleQueue: titles.map((t) => t.id),
      },
    });

    res.status(201).json({ session: toPublicSession(session), titles: titles.map(toPublicTitle) });
  }),
);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  // Optional history filters. Absent = no filter on that axis.
  titleType: z.enum(['MOVIE', 'TV']).optional(),
  mode: z.enum(['SAME_DEVICE', 'MULTI_DEVICE']).optional(),
});

sessionsRouter.get(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const q = listQuerySchema.parse(req.query);

    const where = {
      OR: [{ personAId: me.id }, { personBId: me.id }],
      status: 'COMPLETED' as const,
      ...(q.titleType && { titleType: q.titleType }),
      ...(q.mode && { mode: q.mode }),
    };

    const rows = await prisma.session.findMany({
      where,
      orderBy: { completedAt: 'desc' },
      skip: q.offset,
      take: q.limit + 1,
    });

    const hasMore = rows.length > q.limit;
    const sessions = hasMore ? rows.slice(0, q.limit) : rows;

    if (sessions.length === 0) {
      res.json({ sessions: [], hasMore: false });
      return;
    }

    const ids = sessions.map((s) => s.id);

    const yesVotes = await prisma.vote.findMany({
      where: { sessionId: { in: ids }, decision: 'YES' },
      select: { sessionId: true, titleId: true, voter: true },
    });

    // sessionId -> titleId -> set of voters who said yes.
    const bySession = new Map<string, Map<string, Set<string>>>();
    for (const v of yesVotes) {
      const titles = bySession.get(v.sessionId) ?? new Map<string, Set<string>>();
      const voters = titles.get(v.titleId) ?? new Set<string>();
      voters.add(v.voter);
      titles.set(v.titleId, voters);
      bySession.set(v.sessionId, titles);
    }

    const matchedTitleIds = new Map<string, string[]>();
    for (const [sessionId, titles] of bySession) {
      matchedTitleIds.set(
        sessionId,
        [...titles.entries()]
          .filter(([, voters]) => voters.has('PERSON_A') && voters.has('PERSON_B'))
          .map(([titleId]) => titleId),
      );
    }

    // One more query for the posters of everything matched, across all sessions.
    const allMatched = [...matchedTitleIds.values()].flat();
    const posters = new Map<string, string | null>();
    if (allMatched.length > 0) {
      const rows = await prisma.title.findMany({
        where: { id: { in: allMatched } },
        select: { id: true, posterUrl: true },
      });
      for (const r of rows) posters.set(r.id, r.posterUrl);
    }

    const summaries: SessionSummary[] = sessions.map((s) => {
      const matched = matchedTitleIds.get(s.id) ?? [];
      const iAmA = s.personAId === me.id;

      return {
        id: s.id,
        mode: s.mode,
        status: s.status,
        titleType: s.titleType,
        // "The other person", from whichever side the caller was on.
        partnerLabel: iAmA ? s.personBLabel : s.personALabel,
        matchCount: matched.length,
        matchPosters: matched
          .map((id) => posters.get(id))
          .filter((p): p is string => typeof p === 'string')
          .slice(0, 3),
        mood: s.mood,
        createdAt: s.createdAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
      };
    });

    res.json({ sessions: summaries, hasMore });
  }),
);

sessionsRouter.get(
  '/watch-check',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const since = new Date(Date.now() - WATCH_CHECK_WINDOW_DAYS * 86_400_000);
    const settled = new Date(Date.now() - WATCH_CHECK_MIN_AGE_HOURS * 3_600_000);

    const candidates = await prisma.session.findMany({
      where: {
        OR: [{ personAId: me.id }, { personBId: me.id }],
        status: 'COMPLETED',
        watchLoggedAt: null,
        completedAt: { gte: since, lte: settled },
      },
      orderBy: { completedAt: 'desc' },
      take: 5,
    });

    for (const candidate of candidates) {
      const ids = await matchedTitleIds(candidate.id);
      if (ids.length === 0) continue;

      const titles = await prisma.title.findMany({ where: { id: { in: ids } } });
      const byId = new Map(titles.map((t) => [t.id, t]));
      const ordered = candidate.titleQueue.filter((id) => byId.has(id)).map((id) => byId.get(id)!);

      const iAmA = candidate.personAId === me.id;
      res.json({
        check: {
          session: toPublicSession(candidate),
          matches: ordered.map(toPublicTitle),
          partnerLabel: iAmA ? candidate.personBLabel : candidate.personALabel,
        },
      });
      return;
    }

    res.json({ check: null });
  }),
);

sessionsRouter.get(
  '/active',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;

    const sessions = await prisma.session.findMany({
      where: {
        OR: [{ personAId: me.id }, { personBId: me.id }],
        isAsync: true,
        status: 'IN_PROGRESS',
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 10,
    });

    const active = await Promise.all(
      sessions.map(async (s) => {
        const progress = await getProgress(s);
        const iAmA = s.personAId === me.id;
        const mineDone = iAmA ? progress.personADone : progress.personBDone;
        const theirsDone = iAmA ? progress.personBDone : progress.personADone;

        return {
          session: toPublicSession(s),
          partnerLabel: iAmA ? s.personBLabel : s.personALabel,
          progress,
          yourTurn: !mineDone,
          waitingOnPartner: mineDone && !theirsDone,
        };
      }),
    );

    res.json({ active });
  }),
);

const watchedSchema = z.object({
  watchedTitleId: z.string().min(1).nullable(),
});

sessionsRouter.post(
  '/:id/watched',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);
    const { watchedTitleId } = parseBody(watchedSchema, req.body);

    if (watchedTitleId !== null) {
      const ids = await matchedTitleIds(session.id);
      if (!ids.includes(watchedTitleId)) {
        throw ApiError.badRequest('That title was not one of this session’s matches.');
      }
    }

    const updated = await prisma.session.update({
      where: { id: session.id },
      // Idempotent by nature: re-answering just overwrites the previous answer.
      data: { watchLoggedAt: new Date(), watchedTitleId },
    });

    res.json({ session: toPublicSession(updated) });
  }),
);

sessionsRouter.post(
  '/:code/join',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const code = req.params.code!.trim().toUpperCase();

    const session = await prisma.session.findUnique({ where: { code } });
    if (!session) throw ApiError.notFound("No session with that code. Check the letters?");

    if (session.mode !== 'MULTI_DEVICE') {
      throw ApiError.badRequest('That session is being played on one phone.');
    }
    if (session.status === 'ABANDONED') {
      throw ApiError.conflict('SESSION_CLOSED', 'That session timed out. Ask for a new code.');
    }
    if (session.personAId === me.id) {
      throw ApiError.badRequest("That's your own session — share the code with someone else.");
    }

    // Someone else already took the second seat.
    if (session.personBId && session.personBId !== me.id) {
      throw ApiError.conflict('SESSION_FULL', 'Someone already joined that session.');
    }

    const joined =
      session.personBId === me.id
        ? session // Rejoining; nothing to change.
        : await prisma.session.update({
            where: { id: session.id },
            data: {
              personBId: me.id,
              personBLabel: me.displayName,
              status: 'IN_PROGRESS',
              lastActivityAt: new Date(),
            },
          });

    const titles = await orderedTitles(joined);

    // Wakes person A's waiting screen.
    emitSessionJoined(joined.id, {
      personALabel: joined.personALabel,
      personBLabel: joined.personBLabel,
      titleIds: joined.titleQueue,
    });

    res.json({ session: toPublicSession(joined), titles: titles.map(toPublicTitle) });
  }),
);

const voteSchema = z.object({
  titleId: z.string().min(1),
  voter: z.enum(['PERSON_A', 'PERSON_B']),
  decision: z.enum(['YES', 'NO', 'SEEN', 'MAYBE']),
});

sessionsRouter.post(
  '/:id/votes',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);

    if (session.status === 'COMPLETED' || session.status === 'ABANDONED') {
      throw ApiError.conflict('SESSION_CLOSED', 'This session is already finished.');
    }

    const { titleId, voter, decision } = parseBody(voteSchema, req.body);

    if (!session.titleQueue.includes(titleId)) {
      throw ApiError.badRequest('That title is not part of this session.');
    }

    if (session.mode === 'MULTI_DEVICE') {
      const expected = session.personAId === me.id ? 'PERSON_A' : 'PERSON_B';
      if (voter !== expected) {
        throw ApiError.forbidden(`You vote as ${expected} in this session.`);
      }
    }

    await prisma.vote.upsert({
      where: { sessionId_titleId_voter: { sessionId: session.id, titleId, voter } },
      create: { sessionId: session.id, titleId, voter, decision },
      update: { decision },
    });

    await prisma.session.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    });

    const progress = await getProgress(session);

    emitVoteSubmitted(session.id, progress);

    if (progress.bothDone) {
      await prisma.session.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      emitSessionCompleted(session.id, progress);
    }

    res.status(201).json({ progress });
  }),
);

/** POST /api/sessions/:id/complete — both people are done; freeze the session. */
sessionsRouter.post(
  '/:id/complete',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);

    if (session.status === 'COMPLETED') {
      res.json({ session: toPublicSession(session) });
      return;
    }

    const updated = await prisma.session.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', completedAt: new Date(), lastActivityAt: new Date() },
    });

    res.json({ session: toPublicSession(updated) });
  }),
);

/** GET /api/sessions/:id — session + its titles, for resuming or revisiting. */
sessionsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);

    res.json({
      session: toPublicSession(session),
      titles: (await orderedTitles(session)).map(toPublicTitle),
      progress: await getProgress(session),
    });
  }),
);

sessionsRouter.get(
  '/:id/results',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);

    const votes = await prisma.vote.findMany({ where: { sessionId: session.id } });

    // titleId -> { PERSON_A?: Decision, PERSON_B?: Decision }
    const byTitle = new Map<string, Partial<Record<Voter, Decision>>>();
    for (const v of votes) {
      const entry = byTitle.get(v.titleId) ?? {};
      entry[v.voter] = v.decision;
      byTitle.set(v.titleId, entry);
    }

    const matchedIds: string[] = [];
    const nearMissRaw: { titleId: string; likedBy: Voter; otherDecision: Decision | null }[] = [];

    for (const [titleId, decs] of byTitle) {
      const a = decs.PERSON_A;
      const b = decs.PERSON_B;
      if (a === 'YES' && b === 'YES') {
        matchedIds.push(titleId);
      } else if (a === 'YES' && b !== 'YES') {
        nearMissRaw.push({ titleId, likedBy: 'PERSON_A', otherDecision: b ?? null });
      } else if (b === 'YES' && a !== 'YES') {
        nearMissRaw.push({ titleId, likedBy: 'PERSON_B', otherDecision: a ?? null });
      }
    }

    const closeness = (d: Decision | null) =>
      d === 'MAYBE' ? 0 : d === null ? 1 : d === 'NO' ? 2 : 3;
    const nearMisses = nearMissRaw
      .filter((n) => n.otherDecision !== 'SEEN')
      .sort((x, y) => closeness(x.otherDecision) - closeness(y.otherDecision))
      .slice(0, NEAR_MISS_LIMIT);

    // One query for every title we might return — matches and near-misses both.
    const wantIds = [...matchedIds, ...nearMisses.map((n) => n.titleId)];
    const titles = await prisma.title.findMany({ where: { id: { in: wantIds } } });
    const byId = new Map(titles.map((t) => [t.id, t]));

    // Keep queue order so the matches read in the order they were swiped.
    const ordered = session.titleQueue
      .filter((id) => matchedIds.includes(id) && byId.has(id))
      .map((id) => byId.get(id)!);

    const partnerUserId =
      session.mode === 'MULTI_DEVICE'
        ? session.personAId === me.id
          ? session.personBId
          : session.personAId
        : null;

    res.json({
      session: toPublicSession(session),
      matches: ordered.map(toPublicTitle),
      nearMisses: nearMisses.map((n) => ({
        title: toPublicTitle(byId.get(n.titleId)!),
        likedBy: n.likedBy,
        otherDecision: n.otherDecision,
      })),
      progress: await getProgress(session),
      partnerUserId,
    });
  }),
);

/* ------------------------------------------------------------------ helpers */

async function orderedTitles(session: Session) {
  const titles = await prisma.title.findMany({ where: { id: { in: session.titleQueue } } });
  const byId = new Map(titles.map((t) => [t.id, t]));
  return session.titleQueue.map((id) => byId.get(id)).filter((t) => t !== undefined);
}

async function matchedTitleIds(sessionId: string): Promise<string[]> {
  const yes = await prisma.vote.findMany({
    where: { sessionId, decision: 'YES' },
    select: { titleId: true, voter: true },
  });
  const voters = new Map<string, Set<string>>();
  for (const v of yes) {
    const set = voters.get(v.titleId) ?? new Set<string>();
    set.add(v.voter);
    voters.set(v.titleId, set);
  }
  return [...voters.entries()]
    .filter(([, vs]) => vs.has('PERSON_A') && vs.has('PERSON_B'))
    .map(([id]) => id);
}

/** 404s rather than 403s for other people's sessions — don't confirm they exist. */
async function loadSessionForUser(id: string, userId: string): Promise<Session> {
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) throw ApiError.notFound('That session no longer exists.');

  const mine = session.personAId === userId || session.personBId === userId;
  if (!mine) throw ApiError.notFound('That session no longer exists.');

  return session;
}

/** How far each person has got. Drives the waiting state and the completion check. */
async function getProgress(session: Session) {
  const counts = await prisma.vote.groupBy({
    by: ['voter'],
    where: { sessionId: session.id },
    _count: { _all: true },
  });

  const of = (voter: 'PERSON_A' | 'PERSON_B') =>
    counts.find((c) => c.voter === voter)?._count._all ?? 0;

  const total = session.titleQueue.length;
  const personA = of('PERSON_A');
  const personB = of('PERSON_B');

  return {
    total,
    personA,
    personB,
    personADone: personA >= total,
    personBDone: personB >= total,
    bothDone: personA >= total && personB >= total,
  };
}

export function toPublicSession(s: Session) {
  return {
    id: s.id,
    code: s.code,
    mode: s.mode,
    isAsync: s.isAsync,
    status: s.status,
    personALabel: s.personALabel,
    personBLabel: s.personBLabel,
    region: s.region,
    services: s.services,
    titleType: s.titleType,
    mood: s.mood,
    maxRuntime: s.maxRuntime,
    queueLength: s.titleQueue.length,
    createdAt: s.createdAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
    watchLoggedAt: s.watchLoggedAt?.toISOString() ?? null,
    watchedTitleId: s.watchedTitleId,
  };
}
