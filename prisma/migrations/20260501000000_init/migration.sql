-- CreateEnum
CREATE TYPE "Category" AS ENUM ('BRANDY', 'WHISKY', 'RUM', 'VODKA', 'GIN', 'WINE', 'PREMIX', 'BEER', 'BEVERAGE', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CASHIER', 'SUPPLIER', 'HELPER', 'LOADER', 'COLLECTOR', 'CLEANER', 'WATCHMAN', 'OTHER');

-- CreateEnum
CREATE TYPE "PayrollType" AS ENUM ('SALARY', 'DAILY');

-- CreateEnum
CREATE TYPE "StockEntryType" AS ENUM ('OPENING', 'CLOSING');

-- CreateEnum
CREATE TYPE "IndentStatus" AS ENUM ('PENDING', 'PARTIAL', 'FULLY_RECEIVED', 'STOCK_ADDED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CARD', 'UPI', 'CREDIT', 'SPLIT', 'PENDING');

-- CreateEnum
CREATE TYPE "ScanMethod" AS ENUM ('BARCODE_USB', 'BARCODE_CAMERA', 'MANUAL');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('BREAKAGE', 'RETURN', 'THEFT_WRITEOFF', 'CORRECTION');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('OK', 'LOW', 'HIGH');

-- CreateEnum
CREATE TYPE "MiscCategory" AS ENUM ('CIGARETTES', 'SNACKS', 'CUPS');

-- CreateEnum
CREATE TYPE "BankTxType" AS ENUM ('DEPOSIT', 'KSBCL_PAYMENT');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'COMMITTED', 'VOIDED', 'TAB_OPEN', 'TAB_SETTLED', 'TAB_FORCE_SETTLED');

-- CreateEnum
CREATE TYPE "BillEntityType" AS ENUM ('OWNER', 'CASHIER');

-- CreateEnum
CREATE TYPE "BillSourceType" AS ENUM ('LIQUOR', 'MISC');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "AttributionType" AS ENUM ('COUNTER', 'CLERK');

-- CreateEnum
CREATE TYPE "ClearanceStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GallaEventType" AS ENUM ('SALE_CASH', 'SALE_CARD', 'SALE_UPI', 'REFUND_CASH', 'EXPENSE', 'TRANSFER_TO_LOCKER', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "LockerEventType" AS ENUM ('TRANSFER_IN', 'TRANSFER_OUT', 'DEPOSIT_TO_BANK');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeductionStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('FACE', 'PIN', 'MANUAL_OVERRIDE');

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSize" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "sizeMl" INTEGER NOT NULL,
    "bottlesPerCase" INTEGER NOT NULL,
    "barcode" TEXT,
    "alternateBarcodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ksbclItemCode" TEXT,
    "mrp" DECIMAL(10,2) NOT NULL,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "pin" TEXT,
    "role" "Role" NOT NULL,
    "payrollType" "PayrollType" NOT NULL DEFAULT 'SALARY',
    "monthlySalary" DECIMAL(12,2),
    "dailyWage" DECIMAL(10,2),
    "expectedCheckIn" TEXT,
    "expectedCheckOut" TEXT,
    "lateGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceProfile" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.48,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "descriptor" JSONB,
    "enrolledAt" TIMESTAMP(3),
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSample" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "descriptor" JSONB NOT NULL,
    "detectionScore" DOUBLE PRECISION NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySession" (
    "id" SERIAL NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "staffId" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockEntry" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "entryType" "StockEntryType" NOT NULL,
    "cases" INTEGER NOT NULL DEFAULT 0,
    "bottles" INTEGER NOT NULL DEFAULT 0,
    "totalBottles" INTEGER NOT NULL,

    CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" SERIAL NOT NULL,
    "adjustmentDate" DATE NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "adjustmentType" "AdjustmentType" NOT NULL,
    "quantityBottles" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VarianceRecord" (
    "id" SERIAL NOT NULL,
    "recordDate" DATE NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "expectedBottles" INTEGER NOT NULL,
    "actualBottles" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL,
    "severity" "Severity" NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VarianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Indent" (
    "id" SERIAL NOT NULL,
    "indentNumber" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "retailerName" TEXT NOT NULL,
    "indentDate" DATE NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "rawText" TEXT,
    "parseWarnings" JSONB,
    "totalIndentValue" DECIMAL(12,2),
    "totalConfirmedValue" DECIMAL(12,2),
    "status" "IndentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Indent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndentItem" (
    "id" SERIAL NOT NULL,
    "indentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "ratePerCase" DECIMAL(10,2) NOT NULL,
    "isRationed" BOOLEAN NOT NULL DEFAULT false,
    "indentCases" INTEGER NOT NULL,
    "indentBottles" INTEGER NOT NULL,
    "ksbclItemCode" TEXT,
    "rawItemName" TEXT,
    "parseConfidence" DOUBLE PRECISION,
    "mappingConfidence" DOUBLE PRECISION,
    "isNewItem" BOOLEAN NOT NULL DEFAULT false,
    "indentAmount" DECIMAL(10,2) NOT NULL,
    "cnfCases" INTEGER NOT NULL,
    "cnfBottles" INTEGER NOT NULL,
    "cnfAmount" DECIMAL(10,2) NOT NULL,
    "receivedCases" INTEGER NOT NULL DEFAULT 0,
    "receivedBottles" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IndentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" SERIAL NOT NULL,
    "indentId" INTEGER NOT NULL,
    "receivedDate" DATE NOT NULL,
    "staffId" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "casesReceived" INTEGER NOT NULL,
    "bottlesReceived" INTEGER NOT NULL,
    "totalBottles" INTEGER NOT NULL,

    CONSTRAINT "ReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRecord" (
    "id" SERIAL NOT NULL,
    "recordDate" DATE NOT NULL,
    "openingRegister" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expenses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashToLocker" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingRegister" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cardSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "upiSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" SERIAL NOT NULL,
    "txDate" DATE NOT NULL,
    "txType" "BankTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expenditure" (
    "id" SERIAL NOT NULL,
    "expDate" DATE NOT NULL,
    "particulars" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "categoryId" INTEGER,
    "amount" DECIMAL(10,2) NOT NULL,
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expenditure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiscItem" (
    "id" SERIAL NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category" "MiscCategory" NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "price" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MiscItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "refEntity" TEXT,
    "refEntityId" INTEGER,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" SERIAL NOT NULL,
    "billNumber" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "billedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" INTEGER NOT NULL,
    "attributionType" "AttributionType" NOT NULL DEFAULT 'COUNTER',
    "clerkId" INTEGER,
    "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
    "customerName" TEXT,
    "customerPhone" TEXT,
    "grossTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ownerTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashierTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "netCollectible" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "voidedAt" TIMESTAMP(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillLine" (
    "id" SERIAL NOT NULL,
    "billId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "entityType" "BillEntityType" NOT NULL,
    "sourceType" "BillSourceType" NOT NULL,
    "productSizeId" INTEGER,
    "miscItemId" INTEGER,
    "barcodeSnapshot" TEXT,
    "itemNameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "scanMethod" "ScanMethod" NOT NULL DEFAULT 'MANUAL',
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "isVoidedLine" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" SERIAL NOT NULL,
    "billId" INTEGER NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierSettlement" (
    "id" SERIAL NOT NULL,
    "cashierId" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "approvedMiscSalesTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reimbursableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidById" INTEGER,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashierSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "actorId" INTEGER,
    "eventType" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clerk" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clerk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceBatch" (
    "id" SERIAL NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "originalRate" DECIMAL(10,2) NOT NULL,
    "clearanceRate" DECIMAL(10,2) NOT NULL,
    "totalQuantity" INTEGER NOT NULL,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "ClearanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "createdById" INTEGER NOT NULL,
    "cancelledById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exhaustedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearanceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GallaDay" (
    "id" SERIAL NOT NULL,
    "businessDate" DATE NOT NULL,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "countedAmount" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GallaDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GallaEvent" (
    "id" SERIAL NOT NULL,
    "gallaDayId" INTEGER NOT NULL,
    "eventType" "GallaEventType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "billId" INTEGER,
    "expenditureId" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GallaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockerRecord" (
    "id" SERIAL NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LockerRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockerEvent" (
    "id" SERIAL NOT NULL,
    "lockerId" INTEGER NOT NULL,
    "eventType" "LockerEventType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LockerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySnapshot" (
    "id" SERIAL NOT NULL,
    "gallaDayId" INTEGER NOT NULL,
    "stockMap" JSONB NOT NULL,
    "cashSales" DECIMAL(12,2) NOT NULL,
    "cardSales" DECIMAL(12,2) NOT NULL,
    "upiSales" DECIMAL(12,2) NOT NULL,
    "creditSales" DECIMAL(12,2) NOT NULL,
    "totalExpenses" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" SERIAL NOT NULL,
    "businessDate" DATE NOT NULL,
    "systemCash" DECIMAL(12,2) NOT NULL,
    "systemCard" DECIMAL(12,2) NOT NULL,
    "systemUpi" DECIMAL(12,2) NOT NULL,
    "actualCash" DECIMAL(12,2),
    "actualCard" DECIMAL(12,2),
    "actualUpi" DECIMAL(12,2),
    "cashVariance" DECIMAL(12,2),
    "cardVariance" DECIMAL(12,2),
    "upiVariance" DECIMAL(12,2),
    "notes" TEXT,
    "reconciledById" INTEGER,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalCountSession" (
    "id" SERIAL NOT NULL,
    "sessionDate" DATE NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "conductedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalCountItem" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "productSizeId" INTEGER NOT NULL,
    "systemBottles" INTEGER NOT NULL,
    "countedBottles" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "shortageValue" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PhysicalCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierShortageDeduction" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "settlementId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "DeductionStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierShortageDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "eventType" "AttendanceEventType" NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isEarlyDeparture" BOOLEAN NOT NULL DEFAULT false,
    "shiftStart" TIMESTAMP(3),
    "shiftEnd" TIMESTAMP(3),
    "overrideReason" TEXT,
    "deviceLabel" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "activeDays" INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_itemCode_key" ON "Product"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSize_barcode_key" ON "ProductSize"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSize_ksbclItemCode_key" ON "ProductSize"("ksbclItemCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSize_productId_sizeMl_key" ON "ProductSize"("productId", "sizeMl");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_pin_key" ON "Staff"("pin");

-- CreateIndex
CREATE UNIQUE INDEX "FaceProfile_staffId_key" ON "FaceProfile"("staffId");

-- CreateIndex
CREATE INDEX "FaceSample_profileId_idx" ON "FaceSample"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_staffId_date_key" ON "AttendanceLog"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StockEntry_sessionId_productSizeId_entryType_key" ON "StockEntry"("sessionId", "productSizeId", "entryType");

-- CreateIndex
CREATE UNIQUE INDEX "VarianceRecord_recordDate_productSizeId_key" ON "VarianceRecord"("recordDate", "productSizeId");

-- CreateIndex
CREATE UNIQUE INDEX "Indent_indentNumber_key" ON "Indent"("indentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CashRecord_recordDate_key" ON "CashRecord"("recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MiscItem_barcode_key" ON "MiscItem"("barcode");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_dismissedAt_idx" ON "Notification"("dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_billNumber_key" ON "Bill"("billNumber");

-- CreateIndex
CREATE INDEX "Bill_businessDate_idx" ON "Bill"("businessDate");

-- CreateIndex
CREATE INDEX "Bill_status_idx" ON "Bill"("status");

-- CreateIndex
CREATE INDEX "Bill_operatorId_businessDate_idx" ON "Bill"("operatorId", "businessDate");

-- CreateIndex
CREATE INDEX "Bill_clerkId_businessDate_idx" ON "Bill"("clerkId", "businessDate");

-- CreateIndex
CREATE INDEX "BillLine_productSizeId_idx" ON "BillLine"("productSizeId");

-- CreateIndex
CREATE INDEX "BillLine_miscItemId_idx" ON "BillLine"("miscItemId");

-- CreateIndex
CREATE INDEX "BillLine_entityType_idx" ON "BillLine"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "BillLine_billId_lineNo_key" ON "BillLine"("billId", "lineNo");

-- CreateIndex
CREATE INDEX "PaymentAllocation_billId_idx" ON "PaymentAllocation"("billId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_mode_idx" ON "PaymentAllocation"("mode");

-- CreateIndex
CREATE INDEX "CashierSettlement_status_idx" ON "CashierSettlement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CashierSettlement_cashierId_periodStart_periodEnd_key" ON "CashierSettlement"("cashierId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AuditEvent_entity_entityId_idx" ON "AuditEvent"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");

-- CreateIndex
CREATE INDEX "Clerk_isActive_idx" ON "Clerk"("isActive");

-- CreateIndex
CREATE INDEX "ClearanceBatch_productSizeId_status_idx" ON "ClearanceBatch"("productSizeId", "status");

-- CreateIndex
CREATE INDEX "ClearanceBatch_status_idx" ON "ClearanceBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GallaDay_businessDate_key" ON "GallaDay"("businessDate");

-- CreateIndex
CREATE INDEX "GallaDay_businessDate_idx" ON "GallaDay"("businessDate");

-- CreateIndex
CREATE INDEX "GallaDay_isClosed_idx" ON "GallaDay"("isClosed");

-- CreateIndex
CREATE INDEX "GallaEvent_gallaDayId_idx" ON "GallaEvent"("gallaDayId");

-- CreateIndex
CREATE INDEX "GallaEvent_eventType_idx" ON "GallaEvent"("eventType");

-- CreateIndex
CREATE INDEX "LockerEvent_lockerId_idx" ON "LockerEvent"("lockerId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySnapshot_gallaDayId_key" ON "DailySnapshot"("gallaDayId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_businessDate_key" ON "PaymentReconciliation"("businessDate");

-- CreateIndex
CREATE INDEX "PaymentReconciliation_businessDate_idx" ON "PaymentReconciliation"("businessDate");

-- CreateIndex
CREATE INDEX "PhysicalCountSession_status_idx" ON "PhysicalCountSession"("status");

-- CreateIndex
CREATE INDEX "PhysicalCountSession_sessionDate_idx" ON "PhysicalCountSession"("sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalCountItem_sessionId_productSizeId_key" ON "PhysicalCountItem"("sessionId", "productSizeId");

-- CreateIndex
CREATE INDEX "CashierShortageDeduction_sessionId_idx" ON "CashierShortageDeduction"("sessionId");

-- CreateIndex
CREATE INDEX "CashierShortageDeduction_status_idx" ON "CashierShortageDeduction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_requestId_key" ON "AttendanceEvent"("requestId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_staffId_idx" ON "AttendanceEvent"("staffId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_occurredAt_idx" ON "AttendanceEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "ShiftTemplate_staffId_idx" ON "ShiftTemplate"("staffId");

-- AddForeignKey
ALTER TABLE "ProductSize" ADD CONSTRAINT "ProductSize_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSample" ADD CONSTRAINT "FaceSample_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FaceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventorySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VarianceRecord" ADD CONSTRAINT "VarianceRecord_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentItem" ADD CONSTRAINT "IndentItem_indentId_fkey" FOREIGN KEY ("indentId") REFERENCES "Indent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentItem" ADD CONSTRAINT "IndentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndentItem" ADD CONSTRAINT "IndentItem_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_indentId_fkey" FOREIGN KEY ("indentId") REFERENCES "Indent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_clerkId_fkey" FOREIGN KEY ("clerkId") REFERENCES "Clerk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_miscItemId_fkey" FOREIGN KEY ("miscItemId") REFERENCES "MiscItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSettlement" ADD CONSTRAINT "CashierSettlement_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSettlement" ADD CONSTRAINT "CashierSettlement_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceBatch" ADD CONSTRAINT "ClearanceBatch_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceBatch" ADD CONSTRAINT "ClearanceBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceBatch" ADD CONSTRAINT "ClearanceBatch_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GallaEvent" ADD CONSTRAINT "GallaEvent_gallaDayId_fkey" FOREIGN KEY ("gallaDayId") REFERENCES "GallaDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockerEvent" ADD CONSTRAINT "LockerEvent_lockerId_fkey" FOREIGN KEY ("lockerId") REFERENCES "LockerRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySnapshot" ADD CONSTRAINT "DailySnapshot_gallaDayId_fkey" FOREIGN KEY ("gallaDayId") REFERENCES "GallaDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCountSession" ADD CONSTRAINT "PhysicalCountSession_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCountItem" ADD CONSTRAINT "PhysicalCountItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhysicalCountSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCountItem" ADD CONSTRAINT "PhysicalCountItem_productSizeId_fkey" FOREIGN KEY ("productSizeId") REFERENCES "ProductSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShortageDeduction" ADD CONSTRAINT "CashierShortageDeduction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhysicalCountSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShortageDeduction" ADD CONSTRAINT "CashierShortageDeduction_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CashierSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

