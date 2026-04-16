-- Add billId to Sale for grouping items billed together in one transaction
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "billId" TEXT;
