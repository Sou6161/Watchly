import { beforeAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

/**
 * Guard rail: these tests TRUNCATE tables. Pointing them at a real database would
 * destroy it. Refuse to run unless the database name says "test".
 */
beforeAll(() => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not look like a test database (${url.replace(/:[^:@]*@/, ':***@')}).\n` +
        'These tests truncate every table. Point DATABASE_URL at watchly_test.',
    );
  }
});

/**
 * Truncate rather than drop+recreate: it's ~100x faster, and the schema is applied
 * once by the CI/test bootstrap. RESTART IDENTITY keeps sequences from drifting
 * across runs; CASCADE handles the FK graph so order doesn't matter.
 */
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Vote", "Session", "Title", "User" RESTART IDENTITY CASCADE',
  );
});
