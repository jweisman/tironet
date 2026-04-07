-- Step 1: Add the new JSON column
ALTER TABLE "requests" ADD COLUMN "medical_appointments" JSONB;

-- Step 2: Migrate existing data — convert single appointment to a one-element array
UPDATE "requests"
SET "medical_appointments" = json_build_array(
  json_build_object(
    'id', gen_random_uuid()::text,
    'date', to_char("appointment_date", 'YYYY-MM-DD'),
    'place', COALESCE("appointment_place", ''),
    'type', COALESCE("appointment_type", '')
  )
)
WHERE "type" = 'medical' AND "appointment_date" IS NOT NULL;

-- Step 3: Drop old columns
ALTER TABLE "requests" DROP COLUMN "appointment_date";
ALTER TABLE "requests" DROP COLUMN "appointment_place";
ALTER TABLE "requests" DROP COLUMN "appointment_type";
