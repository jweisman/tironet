-- Backfill any existing NULL subtypes to 'general' before adding the NOT NULL constraint
UPDATE "incidents" SET "subtype" = 'general' WHERE "subtype" IS NULL;

-- AlterTable
ALTER TABLE "incidents" ALTER COLUMN "subtype" SET NOT NULL;
