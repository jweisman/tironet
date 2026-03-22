-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('leave', 'medical', 'hardship');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('open', 'approved', 'denied');

-- CreateEnum
CREATE TYPE "Transportation" AS ENUM ('public_transit', 'shuttle', 'military_transport', 'other');

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "soldier_id" UUID NOT NULL,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'open',
    "assigned_role" "Role" NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "description" TEXT,
    "place" TEXT,
    "departure_at" TIMESTAMPTZ,
    "return_at" TIMESTAMPTZ,
    "transportation" "Transportation",
    "urgent" BOOLEAN,
    "paramedic_date" DATE,
    "appointment_date" DATE,
    "appointment_place" TEXT,
    "appointment_type" TEXT,
    "sick_leave_days" INTEGER,
    "special_conditions" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_requests_cycle_status" ON "requests"("cycle_id", "status");

-- CreateIndex
CREATE INDEX "idx_requests_soldier" ON "requests"("soldier_id");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_soldier_id_fkey" FOREIGN KEY ("soldier_id") REFERENCES "soldiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
