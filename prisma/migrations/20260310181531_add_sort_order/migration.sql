-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "platoons" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "squads" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;
