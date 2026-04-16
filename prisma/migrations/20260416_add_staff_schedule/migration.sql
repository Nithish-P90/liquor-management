-- Add schedule fields to Staff table
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "expectedCheckIn" TEXT;
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "expectedCheckOut" TEXT;
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "lateGraceMinutes" INTEGER NOT NULL DEFAULT 15;
