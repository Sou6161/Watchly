import rateLimit from 'express-rate-limit';
import type { ApiErrorBody } from '@watchly/shared';

const body: ApiErrorBody = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts. Give it a minute.' },
};

/**
 * Login and signup are the brute-force surface: once the API is on a public URL,
 * an attacker can guess passwords as fast as we'll answer. bcrypt at 12 rounds
 * makes each guess expensive for *us* (~250ms of CPU), so an unthrottled login
 * endpoint is also a trivial way to exhaust a free-tier instance.
 *
 * Keyed by IP. Behind Render's proxy that requires `trust proxy`, which is set in
 * index.ts — without it every request would look like it came from the proxy and
 * one attacker would rate-limit everybody.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // per IP per 15 min — generous for a human, useless for a script
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body,
  // Someone who signs in successfully isn't the attacker.
  skipSuccessfulRequests: true,
});

/**
 * Signup, throttled much harder than login.
 *
 * Signup necessarily reveals whether an email is already registered — you have to
 * tell someone "that address is taken" or the form is unusable. That makes it an
 * enumeration oracle, and the only real defence is making it slow: a genuine
 * person signs up once, so five attempts an hour is invisible to them and turns a
 * list of a million addresses into roughly twenty-three years of work.
 *
 * Successful signups still count. Unlike login, repeated *successes* from one IP
 * are the suspicious case, not the innocent one.
 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body,
});

/**
 * A blunt ceiling for everything else. Well above what the app does in normal
 * use (a session is ~15 votes over several minutes) but low enough that a runaway
 * client or a scraper can't melt the free tier.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body,
});
