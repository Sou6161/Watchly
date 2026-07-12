import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, seedTitles, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

describe('title queue', () => {
  it('only returns titles streaming on a service the user has, in their region', async () => {
    const a = await signUp('a@example.com', 'A'); // IN, netflix + hotstar

    await seedTitles(5); // IN/netflix — should appear
    await prisma.title.create({
      data: {
        tmdbId: 9001,
        type: 'MOVIE',
        title: 'Disney Only (US)',
        trailerYoutubeId: 'x',
        genres: ['Comedy'],
        popularity: 999, // deliberately the most popular — must STILL be excluded
        watchProviders: { US: { flatrate: ['disneyplus'] } },
      },
    });
    await prisma.title.create({
      data: {
        tmdbId: 9002,
        type: 'MOVIE',
        title: 'Sony India (not subscribed)',
        trailerYoutubeId: 'y',
        genres: ['Comedy'],
        popularity: 999,
        watchProviders: { IN: { flatrate: ['sonyliv'] } },
      },
    });

    const res = await request(app).get('/api/titles/queue').set(auth(a.accessToken)).expect(200);
    const titles = res.body.titles.map((t: { title: string }) => t.title);

    expect(titles).toHaveLength(5);
    expect(titles).not.toContain('Disney Only (US)');
    expect(titles).not.toContain('Sony India (not subscribed)');
  });

  it('filters by mood genre', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(3, { genres: ['Comedy'] });
    await seedTitles(3, { genres: ['Horror'] });

    const res = await request(app)
      .get('/api/titles/queue?mood=scary')
      .set(auth(a.accessToken))
      .expect(200);

    for (const t of res.body.titles) expect(t.genres).toContain('Horror');
  });

  it('excludes unknown runtimes when a max runtime is asked for', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(2, { runtime: 90 });
    await seedTitles(2, { runtime: 200 });
    await seedTitles(2, { runtime: null });

    const res = await request(app)
      .get('/api/titles/queue?maxRuntime=100')
      .set(auth(a.accessToken))
      .expect(200);

    // A title of unknown length must not be offered under "Under 100 min" — a
    // possible 3-hour epic there breaks trust in the filter.
    for (const t of res.body.titles) {
      expect(t.runtime).not.toBeNull();
      expect(t.runtime).toBeLessThanOrEqual(100);
    }
    expect(res.body.titles).toHaveLength(2);
  });

  /** Spec: don't show titles the user swiped on in the last 30 days. */
  it('excludes titles the user swiped recently, and re-includes them after 30 days', async () => {
    const a = await signUp('a@example.com', 'A');
    const titles = await seedTitles(3);

    const session = await prisma.session.create({
      data: {
        code: 'TEST01',
        mode: 'SAME_DEVICE',
        status: 'COMPLETED',
        personAId: a.id,
        region: 'IN',
        titleQueue: titles.map((t) => t.id),
      },
    });

    await prisma.vote.create({
      data: {
        sessionId: session.id,
        titleId: titles[0]!.id,
        voter: 'PERSON_A',
        decision: 'YES',
      },
    });

    const fresh = await request(app).get('/api/titles/queue').set(auth(a.accessToken)).expect(200);
    expect(fresh.body.titles.map((t: { id: string }) => t.id)).not.toContain(titles[0]!.id);
    expect(fresh.body.titles).toHaveLength(2);

    // Age the vote past the window — it should come back.
    await prisma.vote.updateMany({
      where: { titleId: titles[0]!.id },
      data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const later = await request(app).get('/api/titles/queue').set(auth(a.accessToken)).expect(200);
    expect(later.body.titles.map((t: { id: string }) => t.id)).toContain(titles[0]!.id);
  });

  it('rejects an unknown service', async () => {
    const a = await signUp('a@example.com', 'A');
    await request(app)
      .get('/api/titles/queue?services=hulu')
      .set(auth(a.accessToken))
      .expect(400);
  });
});
