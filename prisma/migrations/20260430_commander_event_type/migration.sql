-- Replace "name" with "type" on commander_events
-- Default existing rows to "leave" since we can't know the original intent

ALTER TABLE "commander_events" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'leave';
ALTER TABLE "commander_events" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "commander_events" DROP COLUMN "name";
