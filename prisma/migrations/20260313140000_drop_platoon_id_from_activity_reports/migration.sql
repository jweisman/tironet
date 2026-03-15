-- Removing the denormalized platoon_id column from activity_reports.
-- PowerSync Sync Streams supports JOINs in queries, so this column
-- is no longer needed to scope activity_reports to a platoon.

DROP INDEX IF EXISTS "idx_activity_reports_platoon";
ALTER TABLE "activity_reports" DROP COLUMN "platoon_id";
