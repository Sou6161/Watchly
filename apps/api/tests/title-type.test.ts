import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, seedTitles, signUp } from './helpers.js';

describe('movie / series separation', () => {
  it('a MOVIE session contains only movies', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(10, { type: 'MOVIE' });
    await seedTitles(10, { type: 'TV' });

    const res = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'MOVIE' })
      .expect(201);

    expect(res.body.titles).toHaveLength(10);
    for (const t of res.body.titles) expect(t.type).toBe('MOVIE');
  });

  it('a TV session contains only series', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(10, { type: 'MOVIE' });
    await seedTitles(10, { type: 'TV' });

    const res = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'TV' })
      .expect(201);

    expect(res.body.titles).toHaveLength(10);
    for (const t of res.body.titles) expect(t.type).toBe('TV');
  });

  it('requires the choice — it is not guessable from anything else', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(5);

    await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE' })
      .expect(422);
  });

  it('records the choice on the session, so revisiting shows the right filter', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(5, { type: 'TV' });

    const created = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'TV' })
      .expect(201);

    expect(created.body.session.titleType).toBe('TV');

    const fetched = await request(app)
      .get(`/api/sessions/${created.body.session.id}`)
      .set(auth(a.accessToken))
      .expect(200);

    expect(fetched.body.session.titleType).toBe('TV');
  });

  it('ignores a runtime cap on a TV session rather than filtering by episode length', async () => {
    const a = await signUp('a@example.com', 'A');
    // A long-running series whose EPISODES are short.
    await seedTitles(4, { type: 'TV', runtime: 42 });
    // And one whose episodes are long — both are valid "start a series" answers.
    await seedTitles(4, { type: 'TV', runtime: 200 });

    const res = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'TV', maxRuntime: 100 })
      .expect(201);

    // All 8 — the cap was correctly ignored, not applied to episode length.
    expect(res.body.titles).toHaveLength(8);
    expect(res.body.session.maxRuntime).toBeNull();
  });

  it('still applies a runtime cap on a MOVIE session', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(4, { type: 'MOVIE', runtime: 90 });
    await seedTitles(4, { type: 'MOVIE', runtime: 200 });

    const res = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'MOVIE', maxRuntime: 100 })
      .expect(201);

    expect(res.body.titles).toHaveLength(4);
    for (const t of res.body.titles) expect(t.runtime).toBeLessThanOrEqual(100);
  });

  it('filters the standalone queue endpoint too', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(6, { type: 'MOVIE' });
    await seedTitles(6, { type: 'TV' });

    const tv = await request(app)
      .get('/api/titles/queue?titleType=TV')
      .set(auth(a.accessToken))
      .expect(200);

    for (const t of tv.body.titles) expect(t.type).toBe('TV');
  });
});
