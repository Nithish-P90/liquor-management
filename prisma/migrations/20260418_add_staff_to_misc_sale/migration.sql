-- Add clerk attribution for miscellaneous sales
ALTER TABLE "MiscSale"
ADD COLUMN "staffId" INTEGER;

-- Backfill existing rows to a valid staff record (prefer cashier, fallback first staff)
WITH preferred_staff AS (
  SELECT id
  FROM "Staff"
  ORDER BY
    CASE WHEN role = 'CASHIER' THEN 0 ELSE 1 END,
    id
  LIMIT 1
)
UPDATE "MiscSale"
SET "staffId" = (SELECT id FROM preferred_staff)
WHERE "staffId" IS NULL;

ALTER TABLE "MiscSale"
ALTER COLUMN "staffId" SET NOT NULL;

ALTER TABLE "MiscSale"
ADD CONSTRAINT "MiscSale_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "MiscSale_staffId_saleDate_idx" ON "MiscSale"("staffId", "saleDate");
