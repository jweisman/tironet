-- Add platoon_id to activity_reports, backfilling from activities.
-- platoon_id is denormalized here so PowerSync sync rules can scope rows
-- to a platoon without a JOIN (PowerSync does not support JOINs in sync rules).

-- Step 1: Add as nullable so existing rows don't fail.
ALTER TABLE "activity_reports" ADD COLUMN "platoon_id" UUID;

-- Step 2: Backfill from the activities table.
UPDATE "activity_reports" ar
SET "platoon_id" = a.platoon_id
FROM "activities" a
WHERE a.id = ar.activity_id;

-- Step 3: Make it NOT NULL now that all rows are populated.
ALTER TABLE "activity_reports" ALTER COLUMN "platoon_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "idx_activity_reports_platoon" ON "activity_reports"("platoon_id");
