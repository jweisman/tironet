-- AlterTable: drop commander note columns from requests
ALTER TABLE "requests" DROP COLUMN "company_commander_note";
ALTER TABLE "requests" DROP COLUMN "platoon_commander_note";

-- CreateTable
CREATE TABLE "request_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "user_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_request_actions_request" ON "request_actions"("request_id");

-- AddForeignKey
ALTER TABLE "request_actions" ADD CONSTRAINT "request_actions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_actions" ADD CONSTRAINT "request_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
