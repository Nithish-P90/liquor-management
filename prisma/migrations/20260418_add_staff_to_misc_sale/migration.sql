-- Add clerk attribution for miscellaneous sales.
-- This migration is written to be safe for fresh deploys and partial reruns.

ALTER TABLE "MiscSale"
ADD COLUMN IF NOT EXISTS "staffId" INTEGER;

DO $$
DECLARE
  v_staff_id INTEGER;
BEGIN
  -- Prefer an active cashier/admin for attribution fallback.
  SELECT s.id
  INTO v_staff_id
  FROM "Staff" s
  WHERE s.active = true
  ORDER BY
    CASE WHEN s.role = 'CASHIER' THEN 0 WHEN s.role = 'ADMIN' THEN 1 ELSE 2 END,
    s.id
  LIMIT 1;

  IF v_staff_id IS NOT NULL THEN
    UPDATE "MiscSale"
    SET "staffId" = v_staff_id
    WHERE "staffId" IS NULL;
  END IF;

  -- Enforce NOT NULL only when no nulls remain.
  IF NOT EXISTS (SELECT 1 FROM "MiscSale" WHERE "staffId" IS NULL) THEN
    ALTER TABLE "MiscSale"
    ALTER COLUMN "staffId" SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MiscSale_staffId_fkey'
  ) THEN
    ALTER TABLE "MiscSale"
    ADD CONSTRAINT "MiscSale_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MiscSale_staffId_saleDate_idx" ON "MiscSale"("staffId", "saleDate");
