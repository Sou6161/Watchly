import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import type { AuthTokens, PublicUser, Region } from '@watchly/shared';
import { env } from '../env.js';
import { prisma } from './prisma.js';
import { ApiError } from './errors.js';

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

interface TokenPayload {
  sub: string;
  /** Distinguishes the two token families so one can't be used as the other. */
  typ: 'access' | 'refresh';
  /**
   * Random per-issuance nonce. Without it the payload is just {sub, typ} and
   * `iat` only has second granularity, so two tokens minted for the same user
   * within the same second are byte-identical — which would silently make
   * refresh-token rotation a no-op (the "old" token is the new one).
   */
  jti: string;
}

function sign(userId: string, typ: TokenPayload['typ']): string {
  const secret = typ === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const expiresIn = typ === 'access' ? env.ACCESS_TOKEN_TTL : env.REFRESH_TOKEN_TTL;
  const payload: TokenPayload = { sub: userId, typ, jti: crypto.randomUUID() };
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

function verify(token: string, typ: TokenPayload['typ']): TokenPayload {
  const secret = typ === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    throw ApiError.unauthorized('Your session expired. Sign in again.');
  }

  const payload = decoded as Partial<TokenPayload>;
  if (typeof payload?.sub !== 'string' || payload.typ !== typ || typeof payload.jti !== 'string') {
    throw ApiError.unauthorized('Your session expired. Sign in again.');
  }
  return { sub: payload.sub, typ, jti: payload.jti };
}

export const verifyAccessToken = (token: string) => verify(token, 'access');

/**
 * We store a SHA-256 of the refresh token rather than the token itself. bcrypt
 * would work too, but refresh happens on every cold start of the app and a
 * fast digest is plenty here: the token is 200+ bits of signed entropy, not a
 * guessable human password, so there is nothing to brute-force.
 */
function digest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a fresh access/refresh pair and persists the refresh hash, replacing
 * whatever was there. Rotating on every refresh means a stolen refresh token
 * stops working the moment the real device next refreshes.
 */
export async function issueTokens(userId: string): Promise<AuthTokens> {
  const accessToken = sign(userId, 'access');
  const refreshToken = sign(userId, 'refresh');

  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: digest(refreshToken) },
  });

  return { accessToken, refreshToken };
}

/** Validates a refresh token against both its signature and the stored hash. */
export async function rotateRefreshToken(refreshToken: string): Promise<{
  tokens: AuthTokens;
  user: User;
}> {
  const { sub } = verify(refreshToken, 'refresh');

  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user || !user.refreshTokenHash) {
    throw ApiError.unauthorized('Your session expired. Sign in again.');
  }

  // A signature-valid token whose hash doesn't match the stored one has been
  // superseded (or revoked at logout) — reject it even though the JWT is intact.
  const presented = Buffer.from(digest(refreshToken));
  const stored = Buffer.from(user.refreshTokenHash);
  if (presented.length !== stored.length || !crypto.timingSafeEqual(presented, stored)) {
    throw ApiError.unauthorized('Your session expired. Sign in again.');
  }

  const tokens = await issueTokens(user.id);
  return { tokens, user };
}

export function revokeRefreshToken(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: null },
  });
}

/**
 * Strips the password hash and refresh hash before a user ever hits the wire,
 * and resolves the saved partner's name.
 *
 * Async because of that lookup. It's one indexed query on a row we usually
 * don't have, and it only fires when a partner is actually saved — cheaper than
 * an unconditional join on every /api/me, and far cheaper than giving the client
 * a way to look up arbitrary users by id.
 */
export async function toPublicUser(user: User): Promise<PublicUser> {
  let partner: PublicUser['partner'] = null;

  if (user.partnerId) {
    const row = await prisma.user.findUnique({
      where: { id: user.partnerId },
      select: { id: true, displayName: true },
    });
    partner = row ?? null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    region: user.region as Region,
    services: user.services,
    partnerId: user.partnerId,
    partner,
    onboarded: user.services.length > 0,
    createdAt: user.createdAt.toISOString(),
  };
}
