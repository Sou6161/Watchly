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
  /** Minimum release year (from the era rule). null = no lower bound. */
  minYear: number | null;
  /** Minimum TMDB rating (from the quality rule). null = anything. */
  minRating: number | null;
  /** Original-language ISO code (from the language rule). null = any language. */
  language: string | null;
  /**
   * Genres to gently favour in the shuffle (the player's learned taste). Unlike
   * `genres`, this is NOT a filter — titles outside it still appear, just less
   * often — so a taste-biased deck stays varied. Empty = no bias.
   */
  tasteGenres: string[];
  limit: number;
}

/**
 * How much a taste-matching title's weight is multiplied in the shuffle. 2.5 is
 * deliberately gentle: enough that "you keep getting thrillers because you love
 * them" is felt, not so much that the deck turns into fifteen of the same thing.
 */
const TASTE_WEIGHT = 2.5;

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
  const {
    region,
    services,
    titleType,
    genres,
    maxRuntime,
    minYear,
    minRating,
    language,
    tasteGenres,
    limit,
  } = filters;

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

  // Era rule: released no earlier than this year. Unknown release year is dropped
  // rather than gambled on — "New" must not smuggle in an undated title.
  if (minYear !== null) {
    conditions.push(Prisma.sql`t."releaseYear" IS NOT NULL AND t."releaseYear" >= ${minYear}`);
  }

  // Quality rule: a rating floor. An unrated title can't clear a bar it has no
  // score for, so it's excluded when the user asks for well-reviewed only.
  if (minRating !== null) {
    conditions.push(Prisma.sql`t.rating IS NOT NULL AND t.rating >= ${minRating}`);
  }

  // Language rule: match TMDB's original_language exactly.
  if (language !== null) {
    conditions.push(Prisma.sql`t.language = ${language}`);
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
   * Each row's sampling weight. Base is popularity; if the player has a learned
   * taste, titles sharing one of their favourite genres get their weight
   * multiplied, so they surface more often WITHOUT being the only thing shown.
   * With no taste history this is just popularity — identical to before.
   */
  const weight =
    tasteGenres.length > 0
      ? Prisma.sql`GREATEST(t.popularity, 0.01) * (CASE WHEN t.genres && ${tasteGenres}::text[] THEN ${TASTE_WEIGHT} ELSE 1 END)`
      : Prisma.sql`GREATEST(t.popularity, 0.01)`;

  /**
   * Weighted shuffle (Efraimidis–Spirakis): ordering by -ln(random()) / weight
   * draws a sample without replacement where each row's chance is proportional to
   * its weight. A plain ORDER BY random() over thousands of titles would mostly
   * surface obscure ones; ordering by weight alone would show the same fifteen
   * cards every night. This gives a fresh deck that leans recognisable — and, with
   * taste weighting, leans toward what this person actually likes.
   */
  return prisma.$queryRaw<Title[]>`
    SELECT t.*
    FROM "Title" t
    WHERE ${where}
    ORDER BY -LN(RANDOM()) / (${weight})
    LIMIT ${limit}
  `;
}
