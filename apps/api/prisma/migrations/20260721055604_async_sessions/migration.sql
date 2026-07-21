-- Asynchronous sessions: person A swipes now, person B finishes later. Defaults
-- to false, so every existing session stays a live/same-device session.
ALTER TABLE "Session" ADD COLUMN "isAsync" BOOLEAN NOT NULL DEFAULT false;
