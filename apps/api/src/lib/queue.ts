import { Prisma, type PrismaClient, type Title } from '@prisma/client';
import { RECENT_SWIPE_EXCLUSION_DAYS, type Region } from '@watchly/shared';

export interface QueueFilters {
  region: Region;
  /** Our internal service ids. A title qualifies if it streams on ANY of them. */
  services: string[];
  /** MOVIE or TV — never both. Chosen before anything else. */
  titleType: 'MOVIE' | 'TV';
  /** Mood genres. A title qualifies if it has ANY of them. Empty = no filter. */
  genres: string[];
  /** Movies only; a series' runtime is per-episode so capping it is meaningless. */
  maxRuntime: number | null;
  limit: number;
}

/**
 * Builds the shuffled candidate pool for a session.
 *
 * Raw SQL rather than the Prisma query builder for three reasons the builder
 * can't express: the jsonb `?|` containment check against watchProviders, the
 * text[] overlap on genres, and weighted-random ordering.
 *
 * `excludeForUserIds` is the people in the session — a title either of them has
 * already swiped on recently is dropped for both, since re-showing it to one
 * person would desync the two queues.
 */
export async function buildQueue(
  prisma: PrismaClient,
  filters: QueueFilters,
  excludeForUserIds: string[],
): Promise<Title[]> {
  const { region, services, titleType, genres, maxRuntime, limit } = filters;

  const conditions: Prisma.Sql[] = [
    // Movie night or series night — never a deck with both mixed in.
    Prisma.sql`t.type = ${titleType}::"TitleType"`,

    // Streamable in this region on at least one service the user pays for.
    // `?|` asks: does this jsonb array share any element with the given text[]?
    Prisma.sql`t."watchProviders" -> ${region} -> 'flatrate' ?| ${services}::text[]`,
  ];

  if (genres.length > 0) {
    // && is array overlap: the title has at least one of the mood's genres.
    conditions.push(Prisma.sql`t.genres && ${genres}::text[]`);
  }

  // Movies only. A series' runtime is per-EPISODE, so "under 100 min" would be
  // satisfied by a 62-episode show — the opposite of what someone asking for
  // something short wants. The client doesn't offer the filter for TV; this guard
  // makes it true regardless of what the client sends.
  if (maxRuntime !== null && titleType === 'MOVIE') {
    // Titles with unknown runtime are excluded when the user asked for something
    // short — showing a possible 3-hour epic under "Under 100 min" breaks trust.
    conditions.push(Prisma.sql`t.runtime IS NOT NULL AND t.runtime <= ${maxRuntime}`);
  }

  // "Don't show titles the user has already swiped on in the last 30 days."
  conditions.push(Prisma.sql`
    NOT EXISTS (
      SELECT 1
      FROM "Vote" v
      JOIN "Session" s ON s.id = v."sessionId"
      WHERE v."titleId" = t.id
        AND (s."personAId" = ANY(${excludeForUserIds}::text[])
          OR s."personBId" = ANY(${excludeForUserIds}::text[]))
        AND v."createdAt" > NOW() - ${`${RECENT_SWIPE_EXCLUSION_DAYS} days`}::interval
    )
  `);

  const where = Prisma.join(conditions, ' AND ');

  /**
   * Popularity-weighted shuffle (Efraimidis–Spirakis): ordering by
   * -ln(random()) / weight draws a sample without replacement where each row's
   * chance is proportional to its weight. A plain ORDER BY random() over ~8k
   * titles would mostly surface obscure ones; ordering by popularity alone would
   * show the same fifteen cards every night. This gives a fresh deck that still
   * leans recognisable.
   */
  return prisma.$queryRaw<Title[]>`
    SELECT t.*
    FROM "Title" t
    WHERE ${where}
    ORDER BY -LN(RANDOM()) / GREATEST(t.popularity, 0.01)
    LIMIT ${limit}
  `;
}
