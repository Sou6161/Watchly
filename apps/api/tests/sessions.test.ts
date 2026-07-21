import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, seedTitles, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/** Backdate a session's completion so the watch-check's "let the night happen" floor passes. */
const ageCompletion = (sessionId: string, hoursAgo = 12) =>
  prisma.session.update({
    where: { id: sessionId },
    data: { completedAt: new Date(Date.now() - hoursAgo * 3_600_000) },
  });

async function createSession(token: string, mode: 'SAME_DEVICE' | 'MULTI_DEVICE' = 'SAME_DEVICE') {
  const res = await request(app)
    .post('/api/sessions')
    .set(auth(token))
    .send({ mode, titleType: 'MOVIE' })
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
      .send({ email: 'bare@example.com', password: 'couch-potato-9', displayName: 'Bare' })
      .expect(201);

    await seedTitles(5);

    await request(app)
      .post('/api/sessions')
      .set(auth(res.body.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'MOVIE' })
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

  it('surfaces one-sided YESes as near-misses, closest first', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session, titles } = await createSession(a.accessToken);
    const [t0, t1, t2, t3] = titles;

    // t0: a real match — must NOT appear as a near-miss.
    await vote(a.accessToken, session.id, t0!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t0!.id, 'PERSON_B', 'YES').expect(201);
    // t1: A liked, B said NO (a far near-miss).
    await vote(a.accessToken, session.id, t1!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t1!.id, 'PERSON_B', 'NO').expect(201);
    // t2: A liked, B was tempted (the closest kind).
    await vote(a.accessToken, session.id, t2!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t2!.id, 'PERSON_B', 'MAYBE').expect(201);
    // t3: A liked, B already SEEN it — dropped, you can't watch it "together".
    await vote(a.accessToken, session.id, t3!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, t3!.id, 'PERSON_B', 'SEEN').expect(201);

    const res = await request(app)
      .get(`/api/sessions/${session.id}/results`)
      .set(auth(a.accessToken))
      .expect(200);

    const nm = res.body.nearMisses as { title: { id: string }; otherDecision: string | null }[];
    expect(nm.map((n) => n.title.id)).toEqual([t2!.id, t1!.id]); // MAYBE before NO, SEEN excluded
    expect(res.body.matches.map((m: { id: string }) => m.id)).toEqual([t0!.id]);
  });

  it('offers a watch-check for a matched night, then never again', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session, titles } = await createSession(a.accessToken);
    const match = titles[0]!;

    await vote(a.accessToken, session.id, match.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, match.id, 'PERSON_B', 'YES').expect(201);
    // Finish the deck so the session completes.
    for (let i = 1; i < titles.length; i++) {
      await vote(a.accessToken, session.id, titles[i]!.id, 'PERSON_A', 'NO').expect(201);
      await vote(a.accessToken, session.id, titles[i]!.id, 'PERSON_B', 'NO').expect(201);
    }

    // Fresh off the match, the prompt is withheld — you haven't had the night yet.
    const tooSoon = await request(app)
      .get('/api/sessions/watch-check')
      .set(auth(a.accessToken))
      .expect(200);
    expect(tooSoon.body.check).toBeNull();

    // Come the morning after, it's there.
    await ageCompletion(session.id);
    const check = await request(app)
      .get('/api/sessions/watch-check')
      .set(auth(a.accessToken))
      .expect(200);
    expect(check.body.check.session.id).toBe(session.id);
    expect(check.body.check.matches.map((m: { id: string }) => m.id)).toEqual([match.id]);

    // Answer it — then the prompt is gone.
    await request(app)
      .post(`/api/sessions/${session.id}/watched`)
      .set(auth(a.accessToken))
      .send({ watchedTitleId: match.id })
      .expect(200);

    const after = await request(app)
      .get('/api/sessions/watch-check')
      .set(auth(a.accessToken))
      .expect(200);
    expect(after.body.check).toBeNull();
  });

  it('rejects a watched title that was not a match', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);
    const { session, titles } = await createSession(a.accessToken);

    // titles[0] got no YESes, so it can't have been "watched together".
    await request(app)
      .post(`/api/sessions/${session.id}/watched`)
      .set(auth(a.accessToken))
      .send({ watchedTitleId: titles[0]!.id })
      .expect(400);
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

describe('taste profile', () => {
  it('is empty before any nights', async () => {
    const a = await signUp('a@example.com', 'A');
    const res = await request(app).get('/api/me/taste').set(auth(a.accessToken)).expect(200);
    expect(res.body).toMatchObject({ nights: 0, swiped: 0, yes: 0, agreement: null, loves: [] });
  });

  it('reflects yeses, agreement, and loved genres after a night', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20); // all genre ['Comedy']
    const { session, titles } = await createSession(a.accessToken);

    // A says yes to the first two, B agrees only on the first.
    await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, titles[1]!.id, 'PERSON_A', 'YES').expect(201);
    await vote(a.accessToken, session.id, titles[0]!.id, 'PERSON_B', 'YES').expect(201);
    await vote(a.accessToken, session.id, titles[1]!.id, 'PERSON_B', 'NO').expect(201);
    // Finish the deck so the session is COMPLETED (taste only counts closed nights).
    for (let i = 2; i < titles.length; i++) {
      await vote(a.accessToken, session.id, titles[i]!.id, 'PERSON_A', 'NO').expect(201);
      await vote(a.accessToken, session.id, titles[i]!.id, 'PERSON_B', 'NO').expect(201);
    }

    const res = await request(app).get('/api/me/taste').set(auth(a.accessToken)).expect(200);
    expect(res.body.nights).toBe(1);
    expect(res.body.yes).toBe(2); // A's two yeses
    // Either-yes titles: {t0, t1}; both-yes: {t0} → 1/2.
    expect(res.body.agreement).toBeCloseTo(0.5);
    expect(res.body.loves[0]).toEqual({ genre: 'Comedy', count: 2 });
  });
});

describe('history list', () => {
  // Completes a session of the given kind so it lands in history.
  async function completeSession(token: string, titleType: 'MOVIE' | 'TV') {
    const created = await request(app)
      .post('/api/sessions')
      .set(auth(token))
      .send({ mode: 'SAME_DEVICE', titleType })
      .expect(201);
    const s = created.body.session as { id: string };
    const titles = created.body.titles as { id: string }[];
    for (const t of titles) {
      await vote(token, s.id, t.id, 'PERSON_A', 'NO').expect(201);
      await vote(token, s.id, t.id, 'PERSON_B', 'NO').expect(201);
    }
    return s.id;
  }

  it('paginates with hasMore and filters by title type', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(40); // movies — enough for two nights after the 30-day exclusion
    await seedTitles(20, { type: 'TV' }); // series for the TV night
    // 2 movie nights, 1 series night.
    await completeSession(a.accessToken, 'MOVIE');
    await completeSession(a.accessToken, 'MOVIE');
    await completeSession(a.accessToken, 'TV');

    // Page of 2 with a third session present → hasMore true.
    const page1 = await request(app)
      .get('/api/sessions?limit=2&offset=0')
      .set(auth(a.accessToken))
      .expect(200);
    expect(page1.body.sessions).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);

    const page2 = await request(app)
      .get('/api/sessions?limit=2&offset=2')
      .set(auth(a.accessToken))
      .expect(200);
    expect(page2.body.sessions).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);

    // Filter to series only.
    const tv = await request(app)
      .get('/api/sessions?titleType=TV')
      .set(auth(a.accessToken))
      .expect(200);
    expect(tv.body.sessions).toHaveLength(1);
    expect(tv.body.sessions[0].titleType).toBe('TV');
  });
});

describe('async sessions', () => {
  it('starts IN_PROGRESS without waiting for person B', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);

    const res = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'MULTI_DEVICE', titleType: 'MOVIE', async: true })
      .expect(201);

    // A live multi-device session would be WAITING here; async lets A swipe now.
    expect(res.body.session.status).toBe('IN_PROGRESS');
    expect(res.body.session.isAsync).toBe(true);
  });

  it('surfaces as active (waiting on B) once A finishes, then completes when B does', async () => {
    const a = await signUp('a@example.com', 'A');
    const b = await signUp('b@example.com', 'B');
    await seedTitles(20);

    const created = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'MULTI_DEVICE', titleType: 'MOVIE', async: true })
      .expect(201);
    const session = created.body.session as { id: string; code: string };
    const titles = created.body.titles as { id: string }[];

    // A swipes the whole deck now.
    for (const t of titles) {
      await vote(a.accessToken, session.id, t.id, 'PERSON_A', 'YES').expect(201);
    }

    // A now sees it in "still going", waiting on B.
    const active = await request(app)
      .get('/api/sessions/active')
      .set(auth(a.accessToken))
      .expect(200);
    expect(active.body.active).toHaveLength(1);
    expect(active.body.active[0]).toMatchObject({ waitingOnPartner: true, yourTurn: false });

    // B joins later and finishes.
    await request(app)
      .post(`/api/sessions/${session.code}/join`)
      .set(auth(b.accessToken))
      .expect(200);
    let last;
    for (const t of titles) {
      last = await vote(b.accessToken, session.id, t.id, 'PERSON_B', 'YES').expect(201);
    }

    // B's final swipe completes the session server-side — no live socket needed.
    expect(last!.body.progress.bothDone).toBe(true);
    const detail = await request(app)
      .get(`/api/sessions/${session.id}`)
      .set(auth(a.accessToken))
      .expect(200);
    expect(detail.body.session.status).toBe('COMPLETED');

    // And it's no longer "active" for either of them.
    const afterA = await request(app)
      .get('/api/sessions/active')
      .set(auth(a.accessToken))
      .expect(200);
    expect(afterA.body.active).toHaveLength(0);
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
