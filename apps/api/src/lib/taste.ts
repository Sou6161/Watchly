import { prisma } from './prisma.js';

/**
 * The genres a user says YES to most, for one media type.
 *
 * This is the app's memory of your taste. Two callers lean on it: "Surprise us"
 * uses it as a hard filter (one confident pick), and the session queue uses it as
 * a soft weight (bias fifteen cards toward what you like without killing variety).
 *
 * Only the account holder's OWN votes count — in a same-device night this one
 * account also casts the guest's votes, and those aren't the owner's taste. Movie
 * and TV genres are different vocabularies, so we never mix them.
 */
export async function lovedGenres(
  userId: string,
  titleType: 'MOVIE' | 'TV',
  limit = 3,
): Promise<string[]> {
  const votes = await prisma.vote.findMany({
    where: {
      decision: 'YES',
      title: { type: titleType },
      session: { OR: [{ personAId: userId }, { personBId: userId }] },
    },
    select: {
      voter: true,
      title: { select: { genres: true } },
      session: { select: { personAId: true } },
    },
  });

  const counts = new Map<string, number>();
  for (const v of votes) {
    const mySide = v.session.personAId === userId ? 'PERSON_A' : 'PERSON_B';
    if (v.voter !== mySide) continue;
    for (const g of v.title.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => g);
}
