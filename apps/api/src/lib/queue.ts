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
  tasteGenres: string[];
  limit: number;
}

const TASTE_WEIGHT = 2.5;

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

    Prisma.sql`t."watchProviders" -> ${region} -> 'flatrate' ?| ${services}::text[]`,
  ];

  if (genres.length > 0) {
    // && is array overlap: the title has at least one of the mood's genres.
    conditions.push(Prisma.sql`t.genres && ${genres}::text[]`);
  }

  if (maxRuntime !== null && titleType === 'MOVIE') {
    conditions.push(Prisma.sql`t.runtime IS NOT NULL AND t.runtime <= ${maxRuntime}`);
  }

  if (minYear !== null) {
    conditions.push(Prisma.sql`t."releaseYear" IS NOT NULL AND t."releaseYear" >= ${minYear}`);
  }

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

  const weight =
    tasteGenres.length > 0
      ? Prisma.sql`GREATEST(t.popularity, 0.01) * (CASE WHEN t.genres && ${tasteGenres}::text[] THEN ${TASTE_WEIGHT} ELSE 1 END)`
      : Prisma.sql`GREATEST(t.popularity, 0.01)`;

  return prisma.$queryRaw<Title[]>`
    SELECT t.*
    FROM "Title" t
    WHERE ${where}
    ORDER BY -LN(RANDOM()) / (${weight})
    LIMIT ${limit}
  `;
}
