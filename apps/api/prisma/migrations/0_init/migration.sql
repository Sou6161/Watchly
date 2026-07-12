-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('SAME_DEVICE', 'MULTI_DEVICE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TitleType" AS ENUM ('MOVIE', 'TV');

-- CreateEnum
CREATE TYPE "Voter" AS ENUM ('PERSON_A', 'PERSON_B');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('YES', 'NO', 'SEEN', 'MAYBE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'IN',
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "partnerId" TEXT,
    "refreshTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'WAITING',
    "personAId" TEXT NOT NULL,
    "personBId" TEXT,
    "personALabel" TEXT NOT NULL DEFAULT 'Person A',
    "personBLabel" TEXT NOT NULL DEFAULT 'Person B',
    "region" TEXT NOT NULL,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mood" TEXT,
    "maxRuntime" INTEGER,
    "titleQueue" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "type" "TitleType" NOT NULL,
    "title" TEXT NOT NULL,
    "posterUrl" TEXT,
    "trailerYoutubeId" TEXT NOT NULL,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "releaseYear" INTEGER,
    "runtime" INTEGER,
    "rating" DOUBLE PRECISION,
    "overview" TEXT,
    "language" TEXT,
    "watchProviders" JSONB NOT NULL DEFAULT '{}',
    "popularity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "voter" "Voter" NOT NULL,
    "decision" "Decision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_code_key" ON "Session"("code");

-- CreateIndex
CREATE INDEX "Session_status_lastActivityAt_idx" ON "Session"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Session_personAId_idx" ON "Session"("personAId");

-- CreateIndex
CREATE INDEX "Session_personBId_idx" ON "Session"("personBId");

-- CreateIndex
CREATE INDEX "Title_popularity_idx" ON "Title"("popularity");

-- CreateIndex
CREATE UNIQUE INDEX "Title_tmdbId_type_key" ON "Title"("tmdbId", "type");

-- CreateIndex
CREATE INDEX "Vote_sessionId_idx" ON "Vote"("sessionId");

-- CreateIndex
CREATE INDEX "Vote_titleId_createdAt_idx" ON "Vote"("titleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_sessionId_titleId_voter_key" ON "Vote"("sessionId", "titleId", "voter");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_personAId_fkey" FOREIGN KEY ("personAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_personBId_fkey" FOREIGN KEY ("personBId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

