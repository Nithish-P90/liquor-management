export const DOMAIN_MODULES = [
  {
    domain: "api-governance",
    owner: "API reliability",
    files: ["lib/api/routes.ts", "lib/domain-modules.ts"],
    purpose: "Single source of truth for API route metadata and behavior module ownership.",
  },
  {
    domain: "auth",
    owner: "Authentication",
    files: ["lib/domains/auth/auth.ts", "lib/domains/auth/api-auth.ts"],
    purpose: "NextAuth credentials configuration and server-side route authorization helpers.",
  },
  {
    domain: "billing-pos",
    owner: "Billing and POS",
    files: ["lib/domains/billing/bill.ts"],
    purpose: "Bill creation, settlement, voiding, line posting, stock deduction, and split accounting behavior.",
  },
  {
    domain: "catalog-import",
    owner: "Product catalog",
    files: ["lib/domains/catalog/product-import.ts", "lib/domains/catalog/infer-category.ts"],
    purpose: "Workbook product import and category inference for catalog setup.",
  },
  {
    domain: "cash-accounting",
    owner: "Cash and ledger",
    files: ["lib/domains/cash/galla.ts", "lib/domains/cash/ledger.ts", "lib/domains/cash/analytics.ts"],
    purpose: "Galla balance, cash close behavior, ledger reporting, and analytics queries.",
  },
  {
    domain: "attendance",
    owner: "Attendance",
    files: ["lib/domains/attendance/attendance.ts"],
    purpose: "Staff punch behavior and attendance log domain logic.",
  },
  {
    domain: "inventory",
    owner: "Inventory control",
    files: [
      "lib/domains/inventory/alerts.ts",
      "lib/domains/inventory/clearance.ts",
      "lib/domains/inventory/eod.ts",
      "lib/domains/inventory/physical-count.ts",
      "lib/domains/inventory/reconciliation.ts",
      "lib/domains/inventory/rollover.ts",
      "lib/domains/inventory/stock.ts",
    ],
    purpose: "Stock movement, clearance, physical count, reconciliation, alerting, rollover, and day-end behavior.",
  },
  {
    domain: "supplier-indents",
    owner: "Supplier receipts",
    files: [
      "lib/domains/indents/ksbcl-match.ts",
      "lib/domains/indents/ksbcl-parser.ts",
      "lib/domains/indents/receipts.ts",
    ],
    purpose: "KSBCL indent parsing, product matching, and receipt posting.",
  },
  {
    domain: "shared-foundation",
    owner: "Shared platform",
    files: [
      "lib/platform/dates.ts",
      "lib/platform/prisma.ts",
      "lib/platform/types.ts",
      "lib/platform/zod-schemas.ts",
    ],
    purpose: "Shared date helpers, Prisma client, branded types, and validation helpers.",
  },
] as const

export const FACADE_MODULES = [
  "lib/alerts.ts",
  "lib/analytics.ts",
  "lib/api-auth.ts",
  "lib/attendance.ts",
  "lib/auth.ts",
  "lib/bill.ts",
  "lib/clearance.ts",
  "lib/dates.ts",
  "lib/eod.ts",
  "lib/galla.ts",
  "lib/infer-category.ts",
  "lib/ksbcl-match.ts",
  "lib/ksbcl-parser.ts",
  "lib/ledger.ts",
  "lib/physical-count.ts",
  "lib/prisma.ts",
  "lib/product-import.ts",
  "lib/receipts.ts",
  "lib/reconciliation.ts",
  "lib/rollover.ts",
  "lib/stock.ts",
  "lib/types.ts",
  "lib/zod-schemas.ts",
] as const

export type DomainModule = (typeof DOMAIN_MODULES)[number]

export function getDomainForFile(file: string): DomainModule | undefined {
  return DOMAIN_MODULES.find((domain) => domain.files.includes(file as never))
}
