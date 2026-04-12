-- CreateTable
CREATE TABLE "report_export_defaults" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "spreadsheet_id" TEXT NOT NULL,
    "spreadsheet_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_export_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_export_defaults_user_id_report_type_key" ON "report_export_defaults"("user_id", "report_type");

-- AddForeignKey
ALTER TABLE "report_export_defaults" ADD CONSTRAINT "report_export_defaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
