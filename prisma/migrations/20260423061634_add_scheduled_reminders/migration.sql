-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "reminder_lead_minutes" INTEGER;

-- CreateTable
CREATE TABLE "scheduled_reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "appointment_id" TEXT,
    "reminder_type" TEXT NOT NULL,
    "qstash_message_id" TEXT,
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "event_at" TIMESTAMPTZ NOT NULL,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_scheduled_reminders_pending" ON "scheduled_reminders"("scheduled_for", "fired");

-- CreateIndex
CREATE INDEX "idx_scheduled_reminders_request" ON "scheduled_reminders"("request_id");

-- CreateIndex
CREATE INDEX "idx_scheduled_reminders_user" ON "scheduled_reminders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_reminders_request_id_user_id_appointment_id_remin_key" ON "scheduled_reminders"("request_id", "user_id", "appointment_id", "reminder_type");

-- AddForeignKey
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
