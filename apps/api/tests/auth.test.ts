import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, signUp } from './helpers.js';

describe('auth', () => {
  it('signs up, and normalises the email', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: '  SOU@Example.COM ', password: 'password123', displayName: 'Sourabh' })
      .expect(201);

    expect(res.body.user.email).toBe('sou@example.com');
    expect(res.body.user.onboarded).toBe(false); // no services yet
    // The hash must never reach the wire.
    expect(JSON.stringify(res.body)).not.toContain('hashedPassword');
    expect(JSON.stringify(res.body)).not.toContain('refreshTokenHash');
  });

  it('rejects a duplicate email', async () => {
    await signUp('a@example.com', 'A');
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'a@example.com', password: 'password123', displayName: 'A' })
      .expect(409);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    await signUp('a@example.com', 'A');

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'nope-wrong' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' })
      .expect(401);

    // Otherwise login doubles as an "is X registered?" oracle.
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  /**
   * Regression: the refresh token payload was once just {sub, typ}, and `iat` has
   * only second granularity — so two tokens minted for the same user within the
   * same second came out BYTE-IDENTICAL. Rotation was a silent no-op and the "old"
   * token kept working. A random jti fixes it. This test would have caught it.
   */
  it('rotates the refresh token, and the old one stops working', async () => {
    const user = await signUp('a@example.com', 'A');

    const first = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    expect(first.body.refreshToken).not.toBe(user.refreshToken);

    // The superseded token must be dead.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    // The new one must live.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);
  });

  it('will not accept an access token as a refresh token', async () => {
    const user = await signUp('a@example.com', 'A');
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.accessToken })
      .expect(401);
  });

  it('revokes the refresh token on logout', async () => {
    const user = await signUp('a@example.com', 'A');

    await request(app).post('/api/auth/logout').set(auth(user.accessToken)).expect(204);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('requires a token on protected routes', async () => {
    await request(app).get('/api/me').expect(401);
    await request(app).get('/api/me').set(auth('garbage')).expect(401);
  });

  it('rejects a short password with a field-level error', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'a@example.com', password: 'short', displayName: 'A' })
      .expect(422);

    expect(res.body.error.fields.password).toBeTruthy();
  });
});
