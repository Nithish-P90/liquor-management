-- Add PENDING to PaymentMode enum
ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'PENDING';

-- Create PendingBill table
CREATE TABLE IF NOT EXISTS "PendingBill" (
  "id"           SERIAL PRIMARY KEY,
  "billRef"      TEXT NOT NULL UNIQUE,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "saleDate"     DATE NOT NULL,
  "staffId"      INTEGER NOT NULL,
  "customerName" TEXT,
  "totalAmount"  DECIMAL(10,2) NOT NULL,
  "settled"      BOOLEAN NOT NULL DEFAULT false,
  "settledAt"    TIMESTAMP(3),
  "settledMode"  "PaymentMode",
  "settledById"  INTEGER,
  CONSTRAINT "PendingBill_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PendingBill_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Create PendingBillItem table
CREATE TABLE IF NOT EXISTS "PendingBillItem" (
  "id"              SERIAL PRIMARY KEY,
  "billId"          INTEGER NOT NULL,
  "productSizeId"   INTEGER NOT NULL,
  "quantityBottles" INTEGER NOT NULL,
  "sellingPrice"    DECIMAL(10,2) NOT NULL,
  "totalAmount"     DECIMAL(10,2) NOT NULL,
  CONSTRAINT "PendingBillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PendingBill"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PendingBillItem_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
