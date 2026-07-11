import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Ambiguous glyphs are omitted: no O/0, no I/1/L. Someone is going to read this
 * code aloud across a room, or squint at it on a QR fallback.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode(): string {
  // rejection-free: 31 symbols doesn't divide 256 evenly, but the bias is tiny
  // and this is a lobby code, not a key. Use randomInt for a clean uniform draw.
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * A code only needs to be unique among *joinable* sessions, but the column has a
 * global unique constraint, so retry on collision. 31^6 ≈ 887M keeps collisions
 * vanishingly rare; the loop is here for correctness, not because it will trip.
 */
export async function generateSessionCode(prisma: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const taken = await prisma.session.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error('Could not generate an unused session code.');
}
