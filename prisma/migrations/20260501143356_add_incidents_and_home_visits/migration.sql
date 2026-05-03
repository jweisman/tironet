-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "soldier_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "response" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "soldier_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "home_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_incidents_soldier" ON "incidents"("soldier_id");

-- CreateIndex
CREATE INDEX "idx_home_visits_soldier" ON "home_visits"("soldier_id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_soldier_id_fkey" FOREIGN KEY ("soldier_id") REFERENCES "soldiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_visits" ADD CONSTRAINT "home_visits_soldier_id_fkey" FOREIGN KEY ("soldier_id") REFERENCES "soldiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
