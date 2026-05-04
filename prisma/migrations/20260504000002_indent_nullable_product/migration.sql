-- Make IndentItem.productId and productSizeId nullable for unmatched KSBCL items
ALTER TABLE "IndentItem" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "IndentItem" ALTER COLUMN "productSizeId" DROP NOT NULL;
