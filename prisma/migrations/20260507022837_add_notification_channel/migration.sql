-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('off', 'in_app', 'sms');

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "channel" "notification_channel" NOT NULL DEFAULT 'in_app';
