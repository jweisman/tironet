-- AlterTable: add phone to users (nullable, unique)
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- AlterTable: make email nullable on invitations and add phone
ALTER TABLE "invitations" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "invitations" ADD COLUMN "phone" TEXT;
