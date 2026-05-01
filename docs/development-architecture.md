# Development Architecture

This project should be developed as a set of small domain modules with traceable API entry points.

## Dependency Direction

Use this direction for new work:

1. `app/(app)/**/page.tsx` renders UI and calls API routes or server actions.
2. `app/api/**/route.ts` authenticates, validates, calls domain behavior, and formats responses.
3. `app/(app)/**/actions.ts` is allowed for page-specific server actions, but should delegate business behavior to `lib/domains/*`.
4. `lib/domains/*` owns business rules, database writes, calculations, transactions, and cross-route behavior.
5. `lib/platform/*` owns shared infrastructure such as dates, Prisma, types, and validation.
6. Root `lib/*.ts` files are compatibility facades only.
7. `prisma/schema.prisma` owns persistence shape and must be checked before changing writes.

Do not move behavior upward into UI files. If logic affects money, stock, staff attendance, audit, or reconciliation, it belongs in `lib/domains/*`.

## Behavior Ownership

The machine-readable ownership map lives in `lib/domain-modules.ts`.

| Domain | Files | Responsibility |
| --- | --- | --- |
| API governance | `lib/api/routes.ts`, `lib/domain-modules.ts` | API route metadata and behavior ownership metadata |
| Auth | `lib/domains/auth/auth.ts`, `lib/domains/auth/api-auth.ts` | Login/session config and route authorization |
| Billing and POS | `lib/domains/billing/bill.ts` | Bill lifecycle, split accounting, stock deduction, settlement, voids |
| Catalog import | `lib/domains/catalog/product-import.ts`, `lib/domains/catalog/infer-category.ts` | Product import and category inference |
| Cash and accounting | `lib/domains/cash/galla.ts`, `lib/domains/cash/ledger.ts`, `lib/domains/cash/analytics.ts` | Galla close, ledger views, analytics queries |
| Attendance | `lib/domains/attendance/attendance.ts` | Staff punch and attendance log behavior |
| Inventory | `lib/domains/inventory/stock.ts`, `lib/domains/inventory/reconciliation.ts`, `lib/domains/inventory/rollover.ts`, `lib/domains/inventory/eod.ts`, `lib/domains/inventory/alerts.ts`, `lib/domains/inventory/clearance.ts`, `lib/domains/inventory/physical-count.ts` | Stock movement, reconciliation, day-end, clearance, physical count |
| Supplier indents | `lib/domains/indents/ksbcl-parser.ts`, `lib/domains/indents/ksbcl-match.ts`, `lib/domains/indents/receipts.ts` | KSBCL parsing, matching, and supplier receipt posting |
| Shared foundation | `lib/platform/dates.ts`, `lib/platform/prisma.ts`, `lib/platform/types.ts`, `lib/platform/zod-schemas.ts` | Shared dates, Prisma client, types, validation |

## API Ownership

The API registry lives in `lib/api/routes.ts`, and the readable route map lives in `docs/api-routes.md`.

Every route must document:

- path and methods
- auth policy
- domain and owner
- purpose
- data read and written
- risk level

## Refactor Strategy

Use staged refactors:

1. Add or update a domain function in `lib/domains/*`.
2. Add focused tests around the domain behavior.
3. Change one route or action to call that function.
4. Update route and file indexes.
5. Run focused checks.

Avoid changing UI, API contracts, Prisma schema, and domain behavior in the same patch unless the feature cannot work otherwise.

## High-Risk Areas

Treat these as high-risk and test them carefully:

- `lib/domains/billing/bill.ts`
- `lib/domains/inventory/stock.ts`
- `lib/domains/cash/galla.ts`
- `lib/domains/inventory/reconciliation.ts`
- `lib/domains/inventory/physical-count.ts`
- `lib/domains/inventory/eod.ts`
- `lib/domains/inventory/rollover.ts`
- `app/api/cron/**`
- `app/api/face/**`
- `prisma/schema.prisma`

## Agent Workflow

Before coding:

1. Read `AGENTS.md`.
2. Read the relevant docs for the touched area.
3. Search for the existing pattern with `rg`.
4. Identify whether the change is UI, route, domain behavior, or schema.

Before finishing:

1. Update `docs/file-index.md` if files changed.
2. Update `lib/domain-modules.ts` if domain modules changed.
3. Update `lib/api/routes.ts` if API routes changed.
4. Run the narrowest useful test.
