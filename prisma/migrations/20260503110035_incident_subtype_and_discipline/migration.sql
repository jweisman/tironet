-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "subtype" TEXT;

-- Rename existing 'infraction' rows to 'discipline'
UPDATE "incidents" SET "type" = 'discipline' WHERE "type" = 'infraction';
