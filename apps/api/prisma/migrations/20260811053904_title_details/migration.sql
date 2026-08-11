-- Details-screen enrichment: backdrop image, top cast, per-region certification,
-- and "more like this" recommendations. All nullable/defaulted, so every existing
-- cached title is unaffected until it's next refreshed or resolved on demand.
ALTER TABLE "Title" ADD COLUMN "backdropUrl" TEXT;
ALTER TABLE "Title" ADD COLUMN "topCast" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Title" ADD COLUMN "certifications" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Title" ADD COLUMN "recommendations" JSONB NOT NULL DEFAULT '[]';
