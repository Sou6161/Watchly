import { Router } from 'express';
import { z } from 'zod';
import type { Session } from '@prisma/client';
import {
  MOOD_IDS,
  NEAR_MISS_LIMIT,
  REGIONS,
  SERVICE_IDS,
  SESSION_QUEUE_SIZE,
  WATCH_CHECK_WINDOW_DAYS,
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
import { toPublicTitle } from './titles.js';
import { emitSessionCompleted, emitSessionJoined, emitVoteSubmitted } from '../realtime.js';

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth);

const createSchema = z.object({
  mode: z.enum(['SAME_DEVICE', 'MULTI_DEVICE']),
  // Movie night or series night. Required — the client asks before anything else.
  titleType: z.enum(['MOVIE', 'TV']),
  mood: z.enum(MOOD_IDS as [string, ...string[]]).nullish(),
  maxRuntime: z.number().int().positive().max(600).nullish(),
  region: z.enum(REGIONS).optional(),
  services: z.array(z.enum(SERVICE_IDS as [string, ...string[]])).optional(),
  // Same-device only: the two names typed at session start.
  personALabel: z.string().trim().min(1).max(24).optional(),
  personBLabel: z.string().trim().min(1).max(24).optional(),
  // Async: person A swipes now and person B finishes whenever. Only meaningful
  // for multi-device — a same-device night already has both people present.
  async: z.boolean().optional(),
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
    // Async only applies to two-phone sessions; a same-device night is inherently
    // synchronous. Silently ignore the flag rather than erroring on a harmless combo.
    const isAsync = body.mode === 'MULTI_DEVICE' && body.async === true;

    if (services.length === 0) {
      throw ApiError.badRequest('Pick at least one streaming service first.');
    }

    // Fetches from TMDB and caches on the fly if the local catalogue can't
    // already satisfy these filters.
    const titles = await ensureQueue(
      prisma,
      {
        region,
        services,
        titleType: body.titleType,
        genres: body.mood ? (moodById(body.mood)?.genres[body.titleType] ?? []) : [],
        // Ignored for series — runtime is per-episode there, so a cap is meaningless.
        maxRuntime: body.titleType === 'MOVIE' ? (body.maxRuntime ?? null) : null,
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
        isAsync,
        // Same-device and async both start swiping immediately (async person A
        // doesn't wait for anyone); only a LIVE multi-device night waits in the
        // lobby for person B to punch in the code.
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

/**
 * GET /api/sessions — the caller's recent sessions, newest first.
 *
 * Computing match counts by pulling every vote for every session would be N+1 in
 * the worst place (the home screen, on every launch). Instead one grouped query
 * gets the YES votes for all the sessions at once, and matches are counted in
 * memory — a match is a title both people said YES to, so it's just the titles
 * whose YES count is 2.
 */
sessionsRouter.get(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const limit = Math.min(Number(req.query.limit ?? 5) || 5, 20);

    const sessions = await prisma.session.findMany({
      where: {
        OR: [{ personAId: me.id }, { personBId: me.id }],
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });

    if (sessions.length === 0) {
      res.json({ sessions: [] });
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

    res.json({ sessions: summaries });
  }),
);

/**
 * GET /api/sessions/watch-check — the morning-after prompt, or null.
 *
 * Returns the most recent completed, matched session the caller hasn't told us
 * about yet — the one worth asking "did you actually watch it?". Nulls out fast
 * in the common case (nothing pending), so the home screen pays almost nothing.
 *
 * Registered ABOVE GET /:id on purpose: Express matches in order, and /:id would
 * otherwise swallow "watch-check" as a session id.
 */
sessionsRouter.get(
  '/watch-check',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const since = new Date(Date.now() - WATCH_CHECK_WINDOW_DAYS * 86_400_000);

    // Newest-first, but a zero-match night has nothing to have watched — so walk a
    // few back until we find one with actual matches rather than nagging or giving
    // up at the first empty session.
    const candidates = await prisma.session.findMany({
      where: {
        OR: [{ personAId: me.id }, { personBId: me.id }],
        status: 'COMPLETED',
        watchLoggedAt: null,
        completedAt: { gte: since },
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

/**
 * GET /api/sessions/active — the caller's open async sessions.
 *
 * These are the "still going" nights: person A has swiped (or is swiping) and is
 * waiting on person B, or vice-versa. Powers the home screen's "in progress"
 * strip. Live sessions never appear here — they're transient and driven by the
 * socket, not something you come back to later.
 *
 * Above GET /:id for the same routing reason as watch-check.
 */
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
          // Whose move is it? If the caller hasn't finished, it's theirs; if they
          // have but the partner hasn't, they're waiting.
          yourTurn: !mineDone,
          waitingOnPartner: mineDone && !theirsDone,
        };
      }),
    );

    res.json({ active });
  }),
);

/**
 * POST /api/sessions/:id/watched — the couple's answer to the watch-loop prompt.
 *
 * watchedTitleId is one of this session's matches (they watched it) or null (they
 * didn't get to it). Either way watchLoggedAt is set, so we never ask twice.
 */
const watchedSchema = z.object({
  watchedTitleId: z.string().min(1).nullable(),
});

sessionsRouter.post(
  '/:id/watched',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const session = await loadSessionForUser(req.params.id!, me.id);
    const { watchedTitleId } = parseBody(watchedSchema, req.body);

    // A watched title must be a real match of this session — otherwise the taste
    // profile can't trust "watched" as ground truth over a mere swipe.
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

    // Every vote, not just the YESes: near-misses need to know what the OTHER
    // person said, which means we have to see the NOs and MAYBEs too.
    const votes = await prisma.vote.findMany({ where: { sessionId: session.id } });

    // titleId -> { PERSON_A?: Decision, PERSON_B?: Decision }
    const byTitle = new Map<string, Partial<Record<Voter, Decision>>>();
    for (const v of votes) {
      const entry = byTitle.get(v.titleId) ?? {};
      entry[v.voter] = v.decision;
      byTitle.set(v.titleId, entry);
    }

    const matchedIds: string[] = [];
    // A near-miss is a title exactly one person said YES to. It turns the dead
    // end of a zero-match night into a shortlist worth arguing over — and even on
    // a matched night, "you were close on these" is a nice second act.
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

    // Closest first: a MAYBE from the other side means they were tempted; an
    // unvoted title (async, or they quit early) is a genuine unknown; a NO is the
    // furthest thing from agreement. SEEN we drop — you can't watch it "together"
    // if one of you already has.
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

    /**
     * The other person's account id, so the results screen can offer "Save
     * partner". Null for same-device sessions — the second player there is just
     * a name typed on this phone, not an account, so there is nobody to save.
     * Computed per-caller rather than baked into toPublicSession, which has no
     * idea who is asking.
     */
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

/**
 * The titles both people said YES to in one session — its matches. Shared by the
 * watch-loop prompt and the /watched guard so "a match" means one thing everywhere.
 */
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
