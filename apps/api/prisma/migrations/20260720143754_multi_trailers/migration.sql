-- Support multiple trailers per title: add an ordered array column, backfill
-- from the single-trailer column so the 5000+ already-cached titles keep
-- their trailer, then drop the old column.
ALTER TABLE "Title" ADD COLUMN "trailerYoutubeIds" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "Title"
SET "trailerYoutubeIds" = ARRAY["trailerYoutubeId"]
WHERE "trailerYoutubeId" IS NOT NULL AND "trailerYoutubeId" <> '';

ALTER TABLE "Title" DROP COLUMN "trailerYoutubeId";
