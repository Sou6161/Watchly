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

function digest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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
