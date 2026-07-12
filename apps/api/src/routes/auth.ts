import { Router } from 'express';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, type AuthResponse } from '@watchly/shared';
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

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email('That does not look like an email address.'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`),
  displayName: z.string().trim().min(1, 'Tell us what to call you.').max(40),
});

authRouter.post(
  '/signup',
  wrap(async (req, res) => {
    const { email, password, displayName } = parseBody(signupSchema, req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.conflict('EMAIL_TAKEN', 'An account already uses that email.');
    }

    const user = await prisma.user.create({
      data: { email, displayName, hashedPassword: await hashPassword(password) },
    });

    const tokens = await issueTokens(user.id);
    const body: AuthResponse = { ...tokens, user: await toPublicUser(user) };
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
