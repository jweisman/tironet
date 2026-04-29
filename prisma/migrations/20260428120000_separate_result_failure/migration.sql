-- Rename ActivityResult enum values: passed → completed, failed → skipped
ALTER TYPE "ActivityResult" RENAME VALUE 'passed' TO 'completed';
ALTER TYPE "ActivityResult" RENAME VALUE 'failed' TO 'skipped';

-- Add failed boolean to activity_reports
ALTER TABLE "activity_reports" ADD COLUMN "failed" BOOLEAN NOT NULL DEFAULT false;

-- Data migration: old "failed" (now "skipped") meant actual failure →
-- convert to completed + failed=true
UPDATE "activity_reports" SET result = 'completed', failed = true WHERE result = 'skipped';

-- Migrate displayConfiguration JSON keys in activity_types:
-- rename results.passed → results.completed, results.failed → results.skipped
UPDATE "activity_types"
SET display_configuration = (
  display_configuration
    #- '{results,passed}'
    #- '{results,failed}'
    || jsonb_build_object('results',
         COALESCE(display_configuration->'results', '{}'::jsonb)
           - 'passed' - 'failed'
           || CASE WHEN display_configuration->'results'->'passed' IS NOT NULL
                THEN jsonb_build_object('completed', display_configuration->'results'->'passed')
                ELSE '{}'::jsonb END
           || CASE WHEN display_configuration->'results'->'failed' IS NOT NULL
                THEN jsonb_build_object('skipped', display_configuration->'results'->'failed')
                ELSE '{}'::jsonb END
       )
)
WHERE display_configuration->'results' IS NOT NULL;
