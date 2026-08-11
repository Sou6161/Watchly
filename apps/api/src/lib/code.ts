import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

export async function generateSessionCode(prisma: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const taken = await prisma.session.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error('Could not generate an unused session code.');
}
