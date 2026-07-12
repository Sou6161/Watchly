import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, seedTitles, signUp } from './helpers.js';

async function createSession(token: string, mode: 'SAME_DEVICE' | 'MULTI_DEVICE' = 'SAME_DEVICE') {
  const res = await request(app)
    .post('/api/sessions')
    .set(auth(token))
    .send({ mode })
    .expect(201);
  return res.body as { session: { id: string; code: string }; titles: { id: string }[] };
}

const vote = (token: string, sessionId: string, titleId: string, voter: string, decision: string) =>
  request(app)
    .post(`/api/sessions/${sessionId}/votes`)
    .set(auth(token))
    .send({ titleId, voter, decision });

describe('sessions', () => {
  it('refuses to build a queue for a user with no services', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'bare@example.com', password: 'password123', displayName: 'Bare' })
      .expect(201);

    await seedTitles(5);

    await request(app)
      .post('/api/sessions')
      .set(auth(res.body.accessToken))
      .send({ mode: 'SAME_DEVICE' })
      .expect(400);
  });

  it('freezes the title queue at creation', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(30);

    const { session, titles } = await createSession(a.accessToken);

    // Re-fetching must give the SAME titles in the SAME order. If the queue were
    // rebuilt per request it would reshuffle (it's randomised) and the two people
    // would silently be swiping different decks.
    const again = await request(app)
      .get(`/api/sessions/${session.id}`)
      .set(auth(a.accessToken))
      .expect(200);

    expect(again.body.titles.map((t: { id: string }) => t.id)).toEqual(titles.map((t) => t.id));
  });

  it('never puts a plot synopsis on a card', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20, { overview: 'The butler did it.' });

    const { titles } = await createSession(a.accessToken);

    // Spec: no spoilers in card metadata. The surest way to honour that is to
    // never ship the field at all.
    for (const t of titles) expect(t).not.toHaveProperty('overview');
  });

  /** A match is a title BOTH people said YES to. Nothing else counts. */
  it('matches only on mutual YES', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);

    const { session, titles } = await createSession(a.accessToken);
    const t = titles;

    // A: yes on 0,1,2 | B: yes on 1,2,3
    await vote(a.accessToken, session.id, t[0]!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t[1]!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t[2]!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t[3]!.id, 'PERSON_A', 'NO').expect(201);

    await vote(a.accessToken, session.id, t[0]!.id, 'PERSON_B', 'NO').expect(201);
    await vote(a.accessToken, session.id, t[1]!.id, 'PERSON_B', 'YES').expect(201);
    await vote(a.accessToken, session.id, t[2]!.id, 'PERSON_B', 'YES').expect(201);
    await vote(a.accessToken, session.id, t[3]!.id, 'PERSON_B', 'YES').expect(201);

    const res = await request(app)
      .get(`/api/sessions/${session.id}/results`)
      .set(auth(a.accessToken))
      .expect(200);

    // 1 and 2 only. 0 was A-only, 3 was B-only.
    expect(res.body.matches.map((m: { id: string }) => m.id)).toEqual([t[1]!.id, t[2]!.id]);
  });

  it('does not treat a mutual MAYBE as a match', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session, titles } = await createSession(a.accessToken);

    await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_A', 'MAYBE').expect(201);
    await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_B', 'MAYBE').expect(201);

    const res = await request(app)
      .get(`/api/sessions/${session.id}/results`)
      .set(auth(a.accessToken))
      .expect(200);

    // The promise on the results screen is "you both said YES". Quietly widening
    // it to MAYBE would erode trust in the one number the product exists to show.
    expect(res.body.matches).toHaveLength(0);
  });

  it('is idempotent per (session, title, voter)', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session, titles } = await createSession(a.accessToken);

    await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_A', 'YES').expect(201);
    // A flaky network retry must not cost a swipe, nor 500 on the unique constraint.
    const res = await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_A', 'NO').expect(201);

    expect(res.body.progress.personA).toBe(1);
  });

  it('rejects a vote on a title outside the session', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session } = await createSession(a.accessToken);

    // Otherwise a client could stuff the results with anything in the catalogue.
    await vote(a.accessToken, session.id, 'not-in-this-queue', 'PERSON_A', 'YES').expect(400);
  });

  it('hides other people’s sessions behind a 404, not a 403', async () => {
    const a = await signUp('a@example.com', 'A');
    const mallory = await signUp('m@example.com', 'Mallory');
    await seedTitles(20);
    const { session } = await createSession(a.accessToken);

    // 403 would confirm the session exists. 404 tells them nothing.
    await request(app)
      .get(`/api/sessions/${session.id}`)
      .set(auth(mallory.accessToken))
      .expect(404);
  });

  it('closes the session server-side once both people finish', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session, titles } = await createSession(a.accessToken);

    for (const t of titles) {
      await vote(a.accessToken, session.id, t.id, 'PERSON_A', 'NO').expect(201);
    }
    let last;
    for (const t of titles) {
      last = await vote(a.accessToken, session.id, t.id, 'PERSON_B', 'NO').expect(201);
    }

    expect(last!.body.progress.bothDone).toBe(true);

    const res = await request(app)
      .get(`/api/sessions/${session.id}`)
      .set(auth(a.accessToken))
      .expect(200);

    // Leaving completion to the client would mean an app dying on the final swipe
    // strands both people's votes forever.
    expect(res.body.session.status).toBe('COMPLETED');

    // And a closed session takes no more votes.
    await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_A', 'YES').expect(409);
  });
});

describe('multi-device join', () => {
  it('lets person B join by code, case-insensitively', async () => {
    const a = await signUp('a@example.com', 'A');
    const b = await signUp('b@example.com', 'B');
    await seedTitles(20);

    const { session, titles } = await createSession(a.accessToken, 'MULTI_DEVICE');

    const res = await request(app)
      .post(`/api/sessions/${session.code.toLowerCase()}/join`)
      .set(auth(b.accessToken))
      .expect(200);

    expect(res.body.session.status).toBe('IN_PROGRESS');
    // Both phones must deal from the identical deck, in identical order.
    expect(res.body.titles.map((t: { id: string }) => t.id)).toEqual(titles.map((t) => t.id));
  });

  it('stops person B voting as person A', async () => {
    const a = await signUp('a@example.com', 'A');
    const b = await signUp('b@example.com', 'B');
    await seedTitles(20);

    const { session, titles } = await createSession(a.accessToken, 'MULTI_DEVICE');
    await request(app)
      .post(`/api/sessions/${session.code}/join`)
      .set(auth(b.accessToken))
      .expect(200);

    await vote(b.accessToken, session.id, titles[0]!.id, 'PERSON_A', 'YES').expect(403);
    await vote(b.accessToken, session.id, titles[0]!.id, 'PERSON_B', 'YES').expect(201);
  });

  it('refuses a third person', async () => {
    const a = await signUp('a@example.com', 'A');
    const b = await signUp('b@example.com', 'B');
    const c = await signUp('c@example.com', 'C');
    await seedTitles(20);

    const { session } = await createSession(a.accessToken, 'MULTI_DEVICE');
    await request(app).post(`/api/sessions/${session.code}/join`).set(auth(b.accessToken)).expect(200);
    await request(app).post(`/api/sessions/${session.code}/join`).set(auth(c.accessToken)).expect(409);
  });

  it('will not let you join your own session', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session } = await createSession(a.accessToken, 'MULTI_DEVICE');

    await request(app).post(`/api/sessions/${session.code}/join`).set(auth(a.accessToken)).expect(400);
  });
});
