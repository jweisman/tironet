-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "battalion_id" UUID;

-- CreateTable
CREATE TABLE "battalions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "battalions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_battalion_id_fkey" FOREIGN KEY ("battalion_id") REFERENCES "battalions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
