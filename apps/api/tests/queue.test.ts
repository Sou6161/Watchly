import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, seedTitles, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { buildQueue, type QueueFilters } from '../src/lib/queue.js';

describe('title queue', () => {
  it('only returns titles streaming on a service the user has, in their region', async () => {
    const a = await signUp('a@example.com', 'A'); // IN, netflix + hotstar

    await seedTitles(5); // IN/netflix — should appear
    await prisma.title.create({
      data: {
        tmdbId: 9001,
        type: 'MOVIE',
        title: 'Disney Only (US)',
        trailerYoutubeIds: ['x'],
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
        trailerYoutubeIds: ['y'],
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

  it('filters by rating floor, dropping unrated titles', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(2, { rating: 8.1 });
    await seedTitles(2, { rating: 5.0 });
    await seedTitles(2, { rating: null });

    const res = await request(app)
      .get('/api/titles/queue?rating=great') // 7.5+
      .set(auth(a.accessToken))
      .expect(200);

    expect(res.body.titles).toHaveLength(2);
    for (const t of res.body.titles) expect(t.rating).toBeGreaterThanOrEqual(7.5);
  });

  it('filters by release era, dropping older and undated titles', async () => {
    const a = await signUp('a@example.com', 'A');
    const thisYear = new Date().getFullYear();
    await seedTitles(2, { releaseYear: thisYear });
    await seedTitles(2, { releaseYear: 1999 });
    await seedTitles(2, { releaseYear: null });

    const res = await request(app)
      .get('/api/titles/queue?era=recent') // last 5 years
      .set(auth(a.accessToken))
      .expect(200);

    expect(res.body.titles).toHaveLength(2);
    for (const t of res.body.titles) expect(t.releaseYear).toBeGreaterThanOrEqual(thisYear - 5);
  });

  it('filters by original language', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(3, { language: 'hi' });
    await seedTitles(3, { language: 'en' });

    const res = await request(app)
      .get('/api/titles/queue?language=hi')
      .set(auth(a.accessToken))
      .expect(200);

    expect(res.body.titles).toHaveLength(3);
  });

  it('surprise returns a single watchable pick', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(10);

    const res = await request(app)
      .get('/api/titles/surprise')
      .set(auth(a.accessToken))
      .expect(200);

    expect(res.body.title).toBeDefined();
    expect(res.body.title.id).toBeTruthy();
    // Never leaks the plot synopsis onto a pick, same as every other card.
    expect(res.body.title.overview).toBeUndefined();
  });

  it('adaptive taste biases the shuffle toward loved genres, without excluding others', async () => {
    // Equal popularity on both piles, so any difference is the taste weight alone.
    await seedTitles(10, { genres: ['Comedy'], popularity: 50 });
    await seedTitles(10, { genres: ['Horror'], popularity: 50 });

    const base: Omit<QueueFilters, 'tasteGenres'> = {
      region: 'IN',
      services: ['netflix'],
      titleType: 'MOVIE',
      genres: [],
      maxRuntime: null,
      minYear: null,
      minRating: null,
      language: null,
      limit: 10,
    };

    const countComedy = async (tasteGenres: string[]) => {
      const q = await buildQueue(prisma, { ...base, tasteGenres }, []);
      return q.filter((t) => t.genres.includes('Comedy')).length;
    };

    const TRIALS = 25;
    let biased = 0;
    let plain = 0;
    for (let i = 0; i < TRIALS; i++) {
      biased += await countComedy(['Comedy']);
      plain += await countComedy([]);
    }

    const biasedAvg = biased / TRIALS;
    const plainAvg = plain / TRIALS;

    expect(plainAvg).toBeGreaterThan(3);
    expect(plainAvg).toBeLessThan(7);
    expect(biasedAvg).toBeGreaterThan(plainAvg + 1);
    expect(biasedAvg).toBeLessThan(10); // never the WHOLE deck — variety survives
  });

  it('the details endpoint includes the overview; the card endpoint never does', async () => {
    const a = await signUp('a@example.com', 'A');
    const [t] = await seedTitles(1, { overview: 'A butler did something.' });

    const queue = await request(app).get('/api/titles/queue').set(auth(a.accessToken)).expect(200);
    expect(queue.body.titles[0].overview).toBeUndefined();

    const detail = await request(app).get(`/api/titles/${t!.id}`).set(auth(a.accessToken)).expect(200);
    expect(detail.body.title.overview).toBe('A butler did something.');
    expect(detail.body.title.id).toBe(t!.id);
  });

  it('404s a details lookup for an unknown title id', async () => {
    const a = await signUp('a@example.com', 'A');
    await request(app)
      .get('/api/titles/not-a-real-id')
      .set(auth(a.accessToken))
      .expect(404);
  });

  it('details include the enrichment fields (backdrop, cast, certification, recommendations)', async () => {
    const a = await signUp('a@example.com', 'A');
    const [t] = await seedTitles(1, {
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/example.jpg',
      topCast: [{ name: 'Someone Famous', character: 'The Lead', profileUrl: null }],
      certifications: { IN: 'U/A 13+', US: 'PG-13' },
      recommendations: [{ tmdbId: 999, type: 'MOVIE', title: 'Something Similar', posterUrl: null }],
    });

    const res = await request(app).get(`/api/titles/${t!.id}`).set(auth(a.accessToken)).expect(200);

    expect(res.body.title.backdropUrl).toBe('https://image.tmdb.org/t/p/w1280/example.jpg');
    expect(res.body.title.topCast).toEqual([
      { name: 'Someone Famous', character: 'The Lead', profileUrl: null },
    ]);
    expect(res.body.title.certifications).toEqual({ IN: 'U/A 13+', US: 'PG-13' });
    expect(res.body.title.recommendations).toEqual([
      { tmdbId: 999, type: 'MOVIE', title: 'Something Similar', posterUrl: null },
    ]);
  });

  it('serves an unenriched title gracefully when there is no TMDB key to self-heal it with', async () => {
    const a = await signUp('a@example.com', 'A');
    const [t] = await seedTitles(1);

    const res = await request(app).get(`/api/titles/${t!.id}`).set(auth(a.accessToken)).expect(200);

    expect(res.body.title.id).toBe(t!.id);
    expect(res.body.title.title).toBe(t!.title);
    expect(res.body.title.backdropUrl).toBeNull();
    expect(res.body.title.topCast).toEqual([]);
  });

  it('resolves an already-cached recommendation without touching TMDB', async () => {
    const a = await signUp('a@example.com', 'A');
    const [t] = await seedTitles(1);

    const res = await request(app)
      .post('/api/titles/resolve')
      .set(auth(a.accessToken))
      .send({ tmdbId: t!.tmdbId, type: 'MOVIE' })
      .expect(200);

    expect(res.body.title.id).toBe(t!.id);
  });

  it('404s resolving an uncached title when there is no TMDB key to fetch it with', async () => {
    const a = await signUp('a@example.com', 'A');

    await request(app)
      .post('/api/titles/resolve')
      .set(auth(a.accessToken))
      .send({ tmdbId: 8675309, type: 'MOVIE' })
      .expect(404);
  });

  it('rejects an unknown service', async () => {
    const a = await signUp('a@example.com', 'A');
    await request(app)
      .get('/api/titles/queue?services=notaservice')
      .set(auth(a.accessToken))
      .expect(400);
  });
});
