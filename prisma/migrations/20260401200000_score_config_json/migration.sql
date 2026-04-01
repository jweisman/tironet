-- Replace 6 individual scoreN_label columns with a single score_config JSONB column.
-- Backfills existing data, preserving all labels with format "number" (the only format before this migration).

-- Step 1: Add the new JSON column
ALTER TABLE "activity_types" ADD COLUMN "score_config" JSONB;

-- Step 2: Backfill from existing columns
UPDATE "activity_types" SET "score_config" = jsonb_build_object(
  'score1', CASE WHEN score1_label IS NOT NULL THEN jsonb_build_object('label', score1_label, 'format', 'number') ELSE 'null'::jsonb END,
  'score2', CASE WHEN score2_label IS NOT NULL THEN jsonb_build_object('label', score2_label, 'format', 'number') ELSE 'null'::jsonb END,
  'score3', CASE WHEN score3_label IS NOT NULL THEN jsonb_build_object('label', score3_label, 'format', 'number') ELSE 'null'::jsonb END,
  'score4', CASE WHEN score4_label IS NOT NULL THEN jsonb_build_object('label', score4_label, 'format', 'number') ELSE 'null'::jsonb END,
  'score5', CASE WHEN score5_label IS NOT NULL THEN jsonb_build_object('label', score5_label, 'format', 'number') ELSE 'null'::jsonb END,
  'score6', CASE WHEN score6_label IS NOT NULL THEN jsonb_build_object('label', score6_label, 'format', 'number') ELSE 'null'::jsonb END
);

-- Step 3: Drop old columns
ALTER TABLE "activity_types" DROP COLUMN "score1_label";
ALTER TABLE "activity_types" DROP COLUMN "score2_label";
ALTER TABLE "activity_types" DROP COLUMN "score3_label";
ALTER TABLE "activity_types" DROP COLUMN "score4_label";
ALTER TABLE "activity_types" DROP COLUMN "score5_label";
ALTER TABLE "activity_types" DROP COLUMN "score6_label";
