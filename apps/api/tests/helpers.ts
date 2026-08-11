import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

export const app = createApp({ rateLimit: false });

export async function signUp(email: string, displayName: string) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'couch-potato-9', displayName })
    .expect(201);

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
          trailerYoutubeIds: [`yt${tmdbId}`],
          posterUrl: `https://example.com/${tmdbId}.jpg`,
          genres: ['Comedy'],
          releaseYear: 2020,
          runtime: 100,
          rating: 7.5,
          popularity: 100 - i,
          watchProviders: { IN: { flatrate: ['netflix'] } } as Prisma.InputJsonValue,
          ...overrides,
          tmdbId,
        },
      }),
    );
  }
  return titles;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
