-- ActivityType: add score label columns
ALTER TABLE "activity_types" ADD COLUMN "score1_label" TEXT DEFAULT 'ציון';
ALTER TABLE "activity_types" ADD COLUMN "score2_label" TEXT;
ALTER TABLE "activity_types" ADD COLUMN "score3_label" TEXT;
ALTER TABLE "activity_types" ADD COLUMN "score4_label" TEXT;
ALTER TABLE "activity_types" ADD COLUMN "score5_label" TEXT;
ALTER TABLE "activity_types" ADD COLUMN "score6_label" TEXT;

-- ActivityReport: rename grade → grade1, add grade2-6
ALTER TABLE "activity_reports" RENAME COLUMN "grade" TO "grade1";
ALTER TABLE "activity_reports" ADD COLUMN "grade2" DECIMAL;
ALTER TABLE "activity_reports" ADD COLUMN "grade3" DECIMAL;
ALTER TABLE "activity_reports" ADD COLUMN "grade4" DECIMAL;
ALTER TABLE "activity_reports" ADD COLUMN "grade5" DECIMAL;
ALTER TABLE "activity_reports" ADD COLUMN "grade6" DECIMAL;
