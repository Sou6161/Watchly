import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, seedTitles, signUp } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

describe('account deletion', () => {
  it('requires the correct password', async () => {
    const a = await signUp('a@example.com', 'A');

    await request(app)
      .delete('/api/me')
      .set(auth(a.accessToken))
      .send({ password: 'not-the-password' })
      .expect(401);

    // Still there.
    await request(app).get('/api/me').set(auth(a.accessToken)).expect(200);
  });

  it('deletes the account and revokes the session', async () => {
    const a = await signUp('a@example.com', 'A');

    await request(app)
      .delete('/api/me')
      .set(auth(a.accessToken))
      .send({ password: 'couch-potato-9' })
      .expect(204);

    await request(app).get('/api/me').set(auth(a.accessToken)).expect(401);

    // And the refresh token can't resurrect it.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: a.refreshToken })
      .expect(401);
  });

  it('takes their own sessions and votes with them', async () => {
    const a = await signUp('a@example.com', 'A');
    await seedTitles(20);

    const created = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'SAME_DEVICE', titleType: 'MOVIE' })
      .expect(201);

    const sessionId = created.body.session.id;
    await request(app)
      .post(`/api/sessions/${sessionId}/votes`)
      .set(auth(a.accessToken))
      .send({ titleId: created.body.titles[0].id, voter: 'PERSON_A', decision: 'YES' })
      .expect(201);

    await request(app)
      .delete('/api/me')
      .set(auth(a.accessToken))
      .send({ password: 'couch-potato-9' })
      .expect(204);

    expect(await prisma.session.findUnique({ where: { id: sessionId } })).toBeNull();
    expect(await prisma.vote.count({ where: { sessionId } })).toBe(0);
  });

  it("does not destroy the partner's history when person B leaves", async () => {
    const a = await signUp('a@example.com', 'Alice');
    const b = await signUp('b@example.com', 'Bob');
    await seedTitles(20);

    const created = await request(app)
      .post('/api/sessions')
      .set(auth(a.accessToken))
      .send({ mode: 'MULTI_DEVICE', titleType: 'MOVIE' })
      .expect(201);

    await request(app)
      .post(`/api/sessions/${created.body.session.code}/join`)
      .set(auth(b.accessToken))
      .expect(200);

    const sessionId = created.body.session.id;

    await request(app)
      .delete('/api/me')
      .set(auth(b.accessToken))
      .send({ password: 'couch-potato-9' })
      .expect(204);

    // The session survives, and Alice can still open it.
    const still = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set(auth(a.accessToken))
      .expect(200);

    expect(still.body.session.personBLabel).toBe('Bob');
    const row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.personBId).toBeNull();
  });

  it('unlinks anyone who saved the deleted user as a partner', async () => {
    const a = await signUp('a@example.com', 'Alice');
    const b = await signUp('b@example.com', 'Bob');

    await request(app)
      .patch('/api/me')
      .set(auth(a.accessToken))
      .send({ partnerId: b.id })
      .expect(200);

    await request(app)
      .delete('/api/me')
      .set(auth(b.accessToken))
      .send({ password: 'couch-potato-9' })
      .expect(204);

    // Alice's account is intact, just without a saved partner.
    const alice = await request(app).get('/api/me').set(auth(a.accessToken)).expect(200);
    expect(alice.body.partnerId).toBeNull();
    expect(alice.body.partner).toBeNull();
  });
});
