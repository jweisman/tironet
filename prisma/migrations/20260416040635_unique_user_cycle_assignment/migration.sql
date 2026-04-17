/*
  Warnings:

  - A unique constraint covering the columns `[user_id,cycle_id]` on the table `user_cycle_assignments` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "user_cycle_assignments_user_id_cycle_id_key" ON "user_cycle_assignments"("user_id", "cycle_id");
