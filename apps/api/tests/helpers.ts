import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

// Rate limiting off: a suite that makes 20 logins would start 429ing itself, and
// the failures would look like real bugs rather than the test tripping over the
// limiter. The limiter has its own test.
export const app = createApp({ rateLimit: false });

export async function signUp(email: string, displayName: string) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'couch-potato-9', displayName })
    .expect(201);

  // A fresh account has no services, and session creation rightly refuses to build
  // a queue for someone who subscribes to nothing.
  await request(app)
    .patch('/api/me')
    .set('authorization', `Bearer ${res.body.accessToken}`)
    .send({ region: 'IN', services: ['netflix', 'hotstar'] })
    .expect(200);

  return {
    id: res.body.user.id as string,
    accessToken: res.body.accessToken as string,
    refreshToken: res.body.refreshToken as string,
  };
}

/**
 * tmdbId is unique per (tmdbId, type), so it must keep climbing across every call
 * within a test — seeding "3 comedies then 3 horrors" would otherwise collide on
 * the second call and fail as if the app were broken.
 */
let nextTmdbId = 1000;

/** Seeds titles that will actually survive the queue filter (IN + netflix). */
export async function seedTitles(count: number, overrides: Partial<Prisma.TitleCreateInput> = {}) {
  const titles = [];
  for (let i = 0; i < count; i++) {
    const tmdbId = nextTmdbId++;
    titles.push(
      await prisma.title.create({
        data: {
          type: 'MOVIE' as const,
          title: `Test Title ${tmdbId}`,
          trailerYoutubeId: `yt${tmdbId}`,
          posterUrl: `https://example.com/${tmdbId}.jpg`,
          genres: ['Comedy'],
          releaseYear: 2020,
          runtime: 100,
          rating: 7.5,
          popularity: 100 - i,
          watchProviders: { IN: { flatrate: ['netflix'] } } as Prisma.InputJsonValue,
          ...overrides,
          // Always last: an overrides.tmdbId would be constant across the loop and
          // collide with itself.
          tmdbId,
        },
      }),
    );
  }
  return titles;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
