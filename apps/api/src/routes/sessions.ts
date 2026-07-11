import { Router } from 'express';
import { z } from 'zod';
import type { Session } from '@prisma/client';
import {
  MOOD_IDS,
  REGIONS,
  SERVICE_IDS,
  SESSION_QUEUE_SIZE,
  moodById,
  type Region,
} from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { parseBody } from '../lib/validate.js';
import { generateSessionCode } from '../lib/code.js';
import { buildQueue } from '../lib/queue.js';
import { toPublicTitle } from './titles.js';
import { emitSessionCompleted, emitSessionJoined, emitVoteSubmitted } from '../realtime.js';

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth);

const createSchema = z.object({
  mode: z.enum(['SAME_DEVICE', 'MULTI_DEVICE']),
  mood: z.enum(MOOD_IDS as [string, ...string[]]).nullish(),
  maxRuntime: z.number().int().positive().max(600).nullish(),
  region: z.enum(REGIONS).optional(),
  services: z.array(z.enum(SERVICE_IDS as [string, ...string[]])).optional(),
  // Same-device only: the two names typed at session start.
  personALabel: z.string().trim().min(1).max(24).optional(),
  personBLabel: z.string().trim().min(1).max(24).optional(),
});

/**
 * POST /api/sessions
 *
 * The title queue is built once, here, and frozen on the session. Both people
 * must swipe the same titles in the same order — rebuilding it per request would
 * reshuffle (the queue is randomised) and desync the two of them.
 */
sessionsRouter.post(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const body = parseBody(createSchema, req.body);

    const region: Region = body.region ?? (me.region as Region);
    const services = body.services ?? me.services;

    if (services.length === 0) {
      throw ApiError.badRequest('Pick at least one streaming service first.');
    }

    const titles = await buildQueue(
      prisma,
      {
        region,
        services,
        genres: body.mood ? (moodById(body.mood)?.genres ?? []) : [],
        maxRuntime: body.maxRuntime ?? null,
        limit: SESSION_QUEUE_SIZE,
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
        // Same-device has both players present from the start; multi-device has
        // to wait for person B to punch in the code.
        status: body.mode === 'SAME_DEVICE' ? 'IN_PROGRESS' : 'WAITING',
        personAId: me.id,
        personALabel: body.personALabel ?? me.displayName,
        personBLabel: body.personBLabel ?? 'Person B',
        region,
        services,
        mood: body.mood ?? null,
        maxRuntime: body.maxRuntime ?? null,
        titleQueue: titles.map((t) => t.id),
      },
    });

    res.status(201).json({ session: toPublicSession(session), titles: titles.map(toPublicTitle) });
  }),
);

/**
 * POST /api/sessions/:code/join — person B joins a multi-device session by code.
 *
 * Idempotent: rejoining a session you're already in returns it rather than
 * erroring, so a reconnect or a double-tap can't lock someone out of their own
 * session.
 */
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

/**
 * POST /api/sessions/:id/votes
 *
 * Idempotent per (session, title, voter): re-submitting overwrites. A flaky
 * network shouldn't cost someone a swipe, and the unique constraint means a
 * retry would otherwise 500.
 */
sessionsRouter.post(
  '/:id/votes',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);

    if (session.status === 'COMPLETED' || session.status === 'ABANDONED') {
      throw ApiError.conflict('SESSION_CLOSED', 'This session is already finished.');
    }

    const { titleId, voter, decision } = parseBody(voteSchema, req.body);

    // Only titles actually dealt in this session may be voted on — otherwise a
    // client could stuff the results with anything in the catalog.
    if (!session.titleQueue.includes(titleId)) {
      throw ApiError.badRequest('That title is not part of this session.');
    }

    // In multi-device, person A can only vote as PERSON_A and B as PERSON_B.
    // In same-device one account submits both, so any voter is legitimate.
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

    // Broadcast the counts (never the decision) so the partner's phone can show
    // "they're on 7 of 15" without revealing anything.
    emitVoteSubmitted(session.id, progress);

    /**
     * The last vote of the session closes it, server-side. Leaving completion to
     * the clients would mean whoever finishes second decides when it's over — and
     * if their app dies on that final swipe, the session hangs forever with both
     * people's votes stranded.
     */
    // (No need to check the status isn't already COMPLETED — the guard at the top
    // of this handler has already rejected closed sessions.)
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

/**
 * GET /api/sessions/:id/results — the titles both people said YES to.
 *
 * MAYBE deliberately doesn't count as a match: the promise on the results screen
 * is "you both said yes", and quietly widening that would erode trust in it.
 */
sessionsRouter.get(
  '/:id/results',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);

    const votes = await prisma.vote.findMany({
      where: { sessionId: session.id, decision: 'YES' },
    });

    const yesBy = new Map<string, Set<string>>();
    for (const v of votes) {
      const set = yesBy.get(v.titleId) ?? new Set<string>();
      set.add(v.voter);
      yesBy.set(v.titleId, set);
    }

    const matchedIds = [...yesBy.entries()]
      .filter(([, voters]) => voters.has('PERSON_A') && voters.has('PERSON_B'))
      .map(([titleId]) => titleId);

    const titles = await prisma.title.findMany({ where: { id: { in: matchedIds } } });
    const byId = new Map(titles.map((t) => [t.id, t]));

    // Keep queue order so the matches read in the order they were swiped.
    const ordered = session.titleQueue
      .filter((id) => byId.has(id))
      .map((id) => byId.get(id)!);

    res.json({
      session: toPublicSession(session),
      matches: ordered.map(toPublicTitle),
      progress: await getProgress(session),
    });
  }),
);

/* ------------------------------------------------------------------ helpers */

/**
 * The session's titles, in queue order.
 *
 * findMany does not preserve the order of an `in` list, and order is the one
 * thing that absolutely must survive: both people swipe the same titles in the
 * same sequence, and a reshuffle would silently desync the two phones.
 */
async function orderedTitles(session: Session) {
  const titles = await prisma.title.findMany({ where: { id: { in: session.titleQueue } } });
  const byId = new Map(titles.map((t) => [t.id, t]));
  return session.titleQueue.map((id) => byId.get(id)).filter((t) => t !== undefined);
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
    status: s.status,
    personALabel: s.personALabel,
    personBLabel: s.personBLabel,
    region: s.region,
    services: s.services,
    mood: s.mood,
    maxRuntime: s.maxRuntime,
    queueLength: s.titleQueue.length,
    createdAt: s.createdAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
  };
}
