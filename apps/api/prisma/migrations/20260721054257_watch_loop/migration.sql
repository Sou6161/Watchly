-- Watch-loop ("did you watch it?"). Both nullable, so existing sessions simply
-- have no answer yet and the prompt never fires for old nights on deploy.
ALTER TABLE "Session" ADD COLUMN "watchLoggedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "watchedTitleId" TEXT;
