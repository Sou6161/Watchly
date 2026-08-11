import { Router } from 'express';
import { z } from 'zod';
import { REGIONS, SERVICE_IDS, servicesForRegion, type Region } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import { toPublicUser, verifyPassword } from '../lib/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { parseBody } from '../lib/validate.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get(
  '/',
  wrap(async (req, res) => {
    res.json(await toPublicUser((req as AuthedRequest).user));
  }),
);

meRouter.get(
  '/taste',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;

    const sessions = await prisma.session.findMany({
      where: {
        OR: [{ personAId: me.id }, { personBId: me.id }],
        status: 'COMPLETED',
      },
      // Newest first so the first watched title we meet is the most recent one.
      orderBy: { completedAt: 'desc' },
      select: {
        personAId: true,
        watchedTitleId: true,
        completedAt: true,
        votes: {
          select: {
            voter: true,
            decision: true,
            titleId: true,
            title: { select: { genres: true } },
          },
        },
      },
    });

    let swiped = 0;
    let yes = 0;
    let seen = 0;
    let bothYesTotal = 0;
    let eitherYesTotal = 0;
    let watchedTogether = 0;
    let lastWatchedTitleId: string | null = null;
    const genreYes = new Map<string, number>();

    for (const session of sessions) {
      if (session.watchedTitleId) {
        watchedTogether++;
        // Sessions are newest-first, so the first one wins.
        if (lastWatchedTitleId === null) lastWatchedTitleId = session.watchedTitleId;
      }

      const mySide = session.personAId === me.id ? 'PERSON_A' : 'PERSON_B';

      const aYes = new Set<string>();
      const bYes = new Set<string>();

      for (const v of session.votes) {
        if (v.voter === mySide) {
          swiped++;
          if (v.decision === 'YES') {
            yes++;
            for (const g of v.title.genres) genreYes.set(g, (genreYes.get(g) ?? 0) + 1);
          }
          if (v.decision === 'SEEN') seen++;
        }
        if (v.decision === 'YES') {
          (v.voter === 'PERSON_A' ? aYes : bYes).add(v.titleId);
        }
      }

      for (const id of new Set([...aYes, ...bYes])) {
        eitherYesTotal++;
        if (aYes.has(id) && bYes.has(id)) bothYesTotal++;
      }
    }

    const loves = [...genreYes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([genre, count]) => ({ genre, count }));

    const WEEK_MS = 7 * 86_400_000;
    const now = Date.now();
    const buckets = new Set<number>();
    for (const s of sessions) {
      if (!s.completedAt) continue;
      buckets.add(Math.floor((now - s.completedAt.getTime()) / WEEK_MS));
    }
    const thisWeek = [...sessions].filter(
      (s) => s.completedAt && now - s.completedAt.getTime() < WEEK_MS,
    ).length;
    let streakWeeks = 0;
    while (buckets.has(streakWeeks)) streakWeeks++;

    const lastWatched = lastWatchedTitleId
      ? await prisma.title.findUnique({
          where: { id: lastWatchedTitleId },
          select: { id: true, title: true, posterUrl: true },
        })
      : null;

    res.json({
      nights: sessions.length,
      swiped,
      yes,
      seen,
      yesRate: swiped > 0 ? yes / swiped : 0,
      agreement: eitherYesTotal > 0 ? bothYesTotal / eitherYesTotal : null,
      watchedTogether,
      lastWatched,
      thisWeek,
      streakWeeks,
      loves,
    });
  }),
);

const deleteSchema = z.object({ password: z.string().min(1) });

meRouter.delete(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const { password } = parseBody(deleteSchema, req.body);

    if (!(await verifyPassword(password, me.hashedPassword))) {
      throw ApiError.unauthorized('That password is not right.');
    }

    await prisma.user.delete({ where: { id: me.id } });

    res.status(204).end();
  }),
);

const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    region: z.enum(REGIONS).optional(),
    services: z
      .array(z.enum(SERVICE_IDS as [string, ...string[]]))
      .max(SERVICE_IDS.length)
      .optional(),
    partnerId: z.string().nullable().optional(),
  })
  .strict();

meRouter.patch(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const patch = parseBody(updateSchema, req.body);

    const region: Region = patch.region ?? (me.region as Region);
    if (patch.services) {
      const allowed = new Set(servicesForRegion(region).map((s) => s.id));
      const stray = patch.services.filter((s) => !allowed.has(s));
      if (stray.length > 0) {
        throw ApiError.badRequest(
          `These services aren't available in ${region}: ${stray.join(', ')}.`,
          { services: `Not available in ${region}: ${stray.join(', ')}` },
        );
      }
    }

    let services = patch.services;
    if (patch.region && !patch.services) {
      const allowed = new Set(servicesForRegion(region).map((s) => s.id));
      services = me.services.filter((s) => allowed.has(s));
    }

    if (patch.partnerId) {
      if (patch.partnerId === me.id) {
        throw ApiError.badRequest('You cannot save yourself as a partner.');
      }
      const partner = await prisma.user.findUnique({ where: { id: patch.partnerId } });
      if (!partner) throw ApiError.notFound('That partner no longer exists.');
    }

    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        ...(patch.displayName !== undefined && { displayName: patch.displayName }),
        ...(patch.region !== undefined && { region: patch.region }),
        ...(services !== undefined && { services }),
        ...(patch.partnerId !== undefined && { partnerId: patch.partnerId }),
      },
    });

    res.json(await toPublicUser(updated));
  }),
);
