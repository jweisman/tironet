/*
  Warnings:

  - You are about to drop the column `sick_leave_days` on the `requests` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "requests" DROP COLUMN "sick_leave_days",
ADD COLUMN     "sick_days" JSONB;
