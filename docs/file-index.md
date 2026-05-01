# File Index

This index is a development reliability tool. Keep it current when files are added, deleted, renamed, or materially repurposed.

## Root

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Mandatory house rules for agents and contributors. |
| `README.md` | Project overview, setup, deployment, and links to verification docs. |
| `package.json` | Scripts, dependencies, Node engine, and Prisma seed command. |
| `package-lock.json` | Locked npm dependency graph. |
| `tsconfig.json` | TypeScript compiler and path alias configuration. |
| `vitest.config.ts` | Vitest configuration and `@/*` alias setup. |
| `next.config.mjs` | Next.js runtime configuration. |
| `tailwind.config.ts` | Tailwind content paths and theme configuration. |
| `postcss.config.mjs` | PostCSS plugins for Tailwind. |
| `render.yaml` | Render deployment configuration. |
| `.env.example` | Environment variable template. |

## App Shell And Pages

| File | Purpose |
| --- | --- |
| `app/layout.tsx` | Root HTML layout, fonts, and global metadata. |
| `app/page.tsx` | Public/root route entry point. |
| `app/login/page.tsx` | PIN login UI. |
| `app/globals.css` | Global Tailwind styles. |
| `app/(app)/layout.tsx` | Protected application layout wrapper. |
| `app/(app)/dashboard/page.tsx` | Operational dashboard. |
| `app/(app)/pos/page.tsx` | POS client UI for scanning, cart, tabs, settlement, and void flows. |
| `app/(app)/pos/actions.ts` | POS server actions that delegate to billing behavior. |
| `app/(app)/products/page.tsx` | Product catalog management UI. |
| `app/(app)/attendance/page.tsx` | Attendance UI and face matching flow. |
| `app/(app)/cash/close/page.tsx` | Galla close UI. |
| `app/(app)/expenses/page.tsx` | Expense entry and listing UI. |
| `app/(app)/ledger/page.tsx` | Ledger reporting UI. |
| `app/(app)/reports/page.tsx` | Reports dashboard UI. |
| `app/(app)/clearance/page.tsx` | Clearance workflow UI. |
| `app/(app)/indents/page.tsx` | Indent listing UI. |
| `app/(app)/indents/upload/page.tsx` | Indent upload and parse UI. |
| `app/(app)/indents/[id]/page.tsx` | Scaffolded indent detail page. |
| `app/(app)/inventory/page.tsx` | Scaffolded inventory overview page. |
| `app/(app)/inventory/opening/page.tsx` | Scaffolded opening inventory page. |
| `app/(app)/inventory/closing/page.tsx` | Scaffolded closing inventory page. |
| `app/(app)/cash/page.tsx` | Scaffolded cash overview page. |
| `app/(app)/sales/page.tsx` | Scaffolded sales page. |
| `app/(app)/misc-sale/page.tsx` | Scaffolded misc sale page. |
| `app/(app)/misc-sale/ledger/page.tsx` | Scaffolded misc ledger page. |
| `app/(app)/pending-bills/page.tsx` | Scaffolded pending bills page. |
| `app/(app)/reports/daily/page.tsx` | Scaffolded daily report page. |
| `app/(app)/staff/page.tsx` | Scaffolded staff page. |
| `app/(app)/clerks/page.tsx` | Scaffolded clerks page. |
| `app/(app)/settings/page.tsx` | Scaffolded settings page. |

## API Routes

Use `docs/api-routes.md` and `lib/api/routes.ts` as the authoritative API index.

## Components

| File | Purpose |
| --- | --- |
| `components/PageShell.tsx` | Shared protected page shell. |
| `components/Sidebar.tsx` | Main protected app navigation. |
| `components/ui/Button.tsx` | Shared button component. |
| `components/ui/Input.tsx` | Shared input component. |

## Domain And Shared Logic

Canonical behavior lives under `lib/domains/*` and shared infrastructure lives under `lib/platform/*`. Root `lib/*.ts` files are compatibility facades only; do not add behavior to those facade files.

| File | Purpose |
| --- | --- |
| `lib/api/routes.ts` | API route registry and route metadata source of truth. |
| `lib/domain-modules.ts` | Domain behavior ownership map and facade index. |
| `lib/domains/auth/auth.ts` | NextAuth credentials provider and session configuration. |
| `lib/domains/auth/api-auth.ts` | API route authorization helpers. |
| `lib/domains/billing/bill.ts` | Bill creation, settlement, void, split accounting, and stock deduction behavior. |
| `lib/domains/inventory/stock.ts` | Stock movement and lot behavior. |
| `lib/domains/inventory/reconciliation.ts` | Inventory reconciliation behavior. |
| `lib/domains/inventory/rollover.ts` | Daily stock rollover behavior. |
| `lib/domains/inventory/eod.ts` | End-of-day processing behavior. |
| `lib/domains/cash/galla.ts` | Galla event and cash close behavior. |
| `lib/domains/cash/ledger.ts` | Ledger reporting behavior. |
| `lib/domains/cash/analytics.ts` | Analytics query behavior. |
| `lib/domains/attendance/attendance.ts` | Staff attendance punch behavior. |
| `lib/domains/inventory/alerts.ts` | Alert creation and notification behavior. |
| `lib/domains/inventory/clearance.ts` | Clearance batch behavior. |
| `lib/domains/inventory/physical-count.ts` | Physical count session and approval behavior. |
| `lib/domains/indents/ksbcl-parser.ts` | KSBCL file parsing behavior. |
| `lib/domains/indents/ksbcl-match.ts` | KSBCL item matching behavior. |
| `lib/domains/indents/receipts.ts` | Supplier receipt posting behavior. |
| `lib/domains/catalog/product-import.ts` | Product workbook import behavior. |
| `lib/domains/catalog/infer-category.ts` | Product category inference helper. |
| `lib/platform/dates.ts` | Date parsing and business date helpers. |
| `lib/platform/prisma.ts` | Shared Prisma client. |
| `lib/platform/types.ts` | Shared branded and domain types. |
| `lib/platform/zod-schemas.ts` | Shared Zod validation helpers and API error helper. |
| `lib/*.ts` | Root compatibility facades that re-export canonical domain/platform modules. |

## Tests

| File | Purpose |
| --- | --- |
| `lib/api/routes.test.ts` | Ensures every API route file and HTTP method is registered. |
| `lib/domain-modules.test.ts` | Ensures every production `lib` module has one domain owner. |
| `lib/domains/billing/bill.test.ts` | Unit coverage for billing behavior. |
| `lib/domains/billing/bill.e2e.test.ts` | End-to-end style billing behavior coverage with mocked persistence. |
| `lib/domains/billing/bill.db.integration.test.ts` | Database-oriented billing integration coverage. |
| `lib/domains/inventory/stock.test.ts` | Stock behavior coverage. |

## Prisma And Scripts

| File | Purpose |
| --- | --- |
| `prisma/schema.prisma` | Database schema and Prisma model definitions. |
| `prisma/seed.ts` | Seed users and optional product workbook import. |
| `prisma/migrations/20260501000000_init/migration.sql` | Initial database migration. |
| `scripts/migrate-deploy-with-retry.sh` | Render migration retry helper. |
| `scripts/setup-face-models.ts` | Face model setup helper. |

## Docs

| File | Purpose |
| --- | --- |
| `docs/development-architecture.md` | Development architecture, dependency direction, and behavior ownership rules. |
| `docs/api-routes.md` | Human-readable API route map. |
| `docs/architecture-checkpoint.md` | Foundation refactor rationale and baseline contract. |
| `docs/file-index.md` | This file index. |
| `docs/requirements-verification.md` | Business requirement verification and known product gaps. |
