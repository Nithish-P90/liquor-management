-- MiscItem: add unit field (pcs/pack/box/strip) and make barcode optional
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS guards

-- 1. Add unit column with default 'pcs' for existing rows
ALTER TABLE "MiscItem"
  ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'pcs';

-- 2. Make barcode nullable (items without barcodes can still be clicked in the UI)
ALTER TABLE "MiscItem"
  ALTER COLUMN "barcode" DROP NOT NULL;
