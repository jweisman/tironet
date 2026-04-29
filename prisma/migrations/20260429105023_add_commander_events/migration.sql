-- CreateTable
CREATE TABLE "commander_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "platoon_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commander_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_commander_events_cycle_platoon" ON "commander_events"("cycle_id", "platoon_id");

-- CreateIndex
CREATE INDEX "idx_commander_events_user" ON "commander_events"("user_id");

-- AddForeignKey
ALTER TABLE "commander_events" ADD CONSTRAINT "commander_events_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commander_events" ADD CONSTRAINT "commander_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commander_events" ADD CONSTRAINT "commander_events_platoon_id_fkey" FOREIGN KEY ("platoon_id") REFERENCES "platoons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
