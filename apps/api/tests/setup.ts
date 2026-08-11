import { beforeAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

beforeAll(() => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not look like a test database (${url.replace(/:[^:@]*@/, ':***@')}).\n` +
        'These tests truncate every table. Point DATABASE_URL at watchly_test.',
    );
  }
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Vote", "Session", "Title", "User" RESTART IDENTITY CASCADE',
  );
});
