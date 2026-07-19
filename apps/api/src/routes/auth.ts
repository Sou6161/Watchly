import { Router } from 'express';
import { z } from 'zod';
import { checkPassword, type AuthResponse } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import {
  hashPassword,
  issueTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  toPublicUser,
  verifyPassword,
} from '../lib/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { parseBody } from '../lib/validate.js';
import { env } from '../env.js';

export const authRouter = Router();

/** Sleeps until `floor` ms have elapsed since `startedAt`. No-op if already past. */
async function padTo(startedAt: number, floor: number): Promise<void> {
  const remaining = floor - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

const signupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('That does not look like an email address.'),
    password: z.string(),
    displayName: z.string().trim().min(1, 'Tell us what to call you.').max(40),
  })
  // Checked here, against the (already normalised) email, so "sourabh@x.com" with
  // the password "sourabh123" is rejected. The client runs the same rule for
  // instant feedback, but a client-side rule is a suggestion — this is the control.
  .superRefine((val, ctx) => {
    const problem = checkPassword(val.password, val.email);
    if (!problem.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: problem.message! });
    }
  });

authRouter.post(
  '/signup',
  wrap(async (req, res) => {
    const { email, password, displayName } = parseBody(signupSchema, req.body);

    const startedAt = Date.now();
    const existing = await prisma.user.findUnique({ where: { email } });

    /**
     * Hash BEFORE branching, always.
     *
     * Returning early on a duplicate skips bcrypt entirely, answering in ~450ms
     * instead of ~1650ms. That gap is an account-enumeration oracle by itself —
     * hiding the error message while leaving it would be theatre, since anyone can
     * time a request.
     */
    const hashedPassword = await hashPassword(password);

    if (existing) {
      /**
       * ...and hashing alone still isn't enough: the success path additionally
       * INSERTs a user and issues tokens, which is two more round trips to a
       * database in another country. Measured, that left ~550ms still on the
       * table.
       *
       * So pad the rejection out to a fixed floor. Both answers now take about the
       * same wall-clock time regardless of whether the address exists.
       *
       * This is belt-and-braces: the 5-per-hour signup limiter already makes
       * enumeration impractical (a million addresses would take ~23 years). But
       * defence that relies on one control is defence that fails when that control
       * is misconfigured.
       */
      await padTo(startedAt, env.SIGNUP_TIME_FLOOR_MS);
      throw ApiError.conflict('EMAIL_TAKEN', 'An account already uses that email.');
    }

    const user = await prisma.user.create({
      data: { email, displayName, hashedPassword },
    });

    const tokens = await issueTokens(user.id);
    const body: AuthResponse = { ...tokens, user: await toPublicUser(user) };

    // Same floor as the rejection path — otherwise success becomes the fast answer
    // and the oracle simply flips direction.
    await padTo(startedAt, env.SIGNUP_TIME_FLOOR_MS);
    res.status(201).json(body);
  }),
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = parseBody(loginSchema, req.body);

    const user = await prisma.user.findUnique({ where: { email } });

    // Deliberately identical error whether the email is unknown or the password
    // is wrong — otherwise this endpoint doubles as an "is X registered?" oracle.
    const ok = user && (await verifyPassword(password, user.hashedPassword));
    if (!user || !ok) {
      throw ApiError.unauthorized('Email or password is incorrect.');
    }

    const tokens = await issueTokens(user.id);
    const body: AuthResponse = { ...tokens, user: await toPublicUser(user) };
    res.json(body);
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    const { refreshToken } = parseBody(refreshSchema, req.body);
    const { tokens, user } = await rotateRefreshToken(refreshToken);
    const body: AuthResponse = { ...tokens, user: await toPublicUser(user) };
    res.json(body);
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  wrap(async (req, res) => {
    await revokeRefreshToken((req as AuthedRequest).user.id);
    res.status(204).end();
  }),
);
