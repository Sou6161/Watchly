import rateLimit from 'express-rate-limit';
import type { ApiErrorBody } from '@watchly/shared';

const body: ApiErrorBody = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts. Give it a minute.' },
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // per IP per 15 min — generous for a human, useless for a script
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body,
  // Someone who signs in successfully isn't the attacker.
  skipSuccessfulRequests: true,
});

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body,
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body,
});
