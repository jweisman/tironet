-- Rename denial_reason to platoon_commander_note and add company_commander_note
ALTER TABLE "requests" RENAME COLUMN "denial_reason" TO "platoon_commander_note";
ALTER TABLE "requests" ADD COLUMN "company_commander_note" TEXT;
