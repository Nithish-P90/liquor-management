# File Index

This index is a development reliability tool. Keep it current when files are added, deleted, renamed, or materially repurposed.

## Root

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Mandatory house rules for agents and contributors. |
| `AGENT.md` | Alias entry-point for agent runtimes that look for singular naming. |
| `agent.md` | Lowercase alias entry-point for agent runtimes with case-sensitive conventions. |
| `COLLAB_TASKS.md` | Shared task-claim board for multi-contributor conflict avoidance. |
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
| `app/(app)/pos/page.tsx` | POS client UI for scanning, cart, tabs, settlement, and return flows. |
| `app/(app)/pos/api-client.ts` | POS REST client wrappers for billing operations. |
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
| `app/(app)/inventory/page.tsx` | Inventory hub with session status and quick links to opening stock, the catalog, and closing count. |
| `app/(app)/inventory/opening/page.tsx` | Opening stock page for viewing the active session and editing opening balances as an admin. |
| `app/(app)/inventory/catalog/page.tsx` | Inventory catalog page showing live stock snapshot and admin entry point for opening-stock adjustments. |
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

| File | Purpose |
| --- | --- |
| `app/api/pos/bills/compute/route.ts` | POS cart pricing preview endpoint. |
| `app/api/pos/bills/commit/route.ts` | POS bill commit endpoint. |
| `app/api/pos/bills/open-tab/route.ts` | POS open-tab endpoint. |
| `app/api/pos/bills/settle-tab/route.ts` | POS tab settlement endpoint. |
| `app/api/pos/bills/return/route.ts` | POS return endpoint. |
| `app/api/misc-items/route.ts` | Admin misc-item catalog endpoint for listing and creation. |
| `app/api/misc-items/[id]/route.ts` | Admin misc-item update endpoint. |
| `app/api/misc-items/metrics/route.ts` | Admin misc sales metrics endpoint. |
| `app/api/attendance/metrics/route.ts` | Attendance metrics report endpoint. |
| `app/api/inventory/sessions/route.ts` | Inventory session status endpoint that self-heals by running rollover when needed. |
| `app/api/reports/third-party-payout/route.ts` | Third-party payout report endpoint. |
| `app/api/staff/metrics/route.ts` | Staff metrics report endpoint. |
| `app/api/staff/payroll/route.ts` | Staff payroll report endpoint. |

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
| `.github/workflows/ci-and-deploy.yml` | CI gate for install, Prisma generation, lint, typecheck, tests, and build. |
| `.github/workflows/rollover-schedule.yml` | Scheduled workflow that triggers the production rollover endpoint. |
| `.github/pull_request_template.md` | PR contract checklist for ownership, writable paths, validation, and rollback. |
| `lib/api/handler.ts` | Shared API helpers for auth policy checks, query/body parsing, success responses, and error boundaries. |
| `lib/api/routes.ts` | API route registry and route metadata source of truth. |
| `lib/domain-modules.ts` | Domain behavior ownership map and facade index. |
| `lib/domains/auth/auth.ts` | NextAuth credentials provider and session configuration. |
| `lib/domains/auth/api-auth.ts` | API route authorization helpers. |
| `lib/domains/auth/types.ts` | Auth domain type exports. |
| `lib/domains/billing/bill.ts` | Bill creation, settlement, void, split accounting, stock deduction, and return processing (via StockAdjustment and GallaEvent). |
| `lib/domains/billing/types.ts` | Billing domain type exports. |
| `lib/domains/billing/compute.ts` | Canonical cart pricing and split subtotal computation. |
| `lib/domains/billing/preconditions.ts` | Shared billing precondition checks for POS routes. |
| `lib/domains/billing/third-party-ledger.ts` | Third-party payout summary queries. |
| `lib/domains/inventory/stock.ts` | Stock movement and lot behavior. |
| `lib/domains/inventory/reconciliation.ts` | Inventory reconciliation behavior. |
| `lib/domains/inventory/rollover.ts` | Daily stock rollover behavior. |
| `lib/domains/inventory/eod.ts` | End-of-day processing behavior. |
| `lib/domains/inventory/stock-entry.ts` | Opening stock bootstrap behavior for day one. |
| `lib/domains/cash/galla.ts` | Galla event and cash close behavior. |
| `lib/domains/cash/ledger.ts` | Ledger reporting behavior. |
| `lib/domains/cash/analytics.ts` | Analytics query behavior. |
| `lib/domains/attendance/attendance.ts` | Staff attendance punch behavior. |
| `lib/domains/attendance/metrics.ts` | Attendance metrics behavior. |
| `lib/domains/inventory/alerts.ts` | Alert creation and notification behavior. |
| `lib/domains/inventory/clearance.ts` | Clearance batch behavior. |
| `lib/domains/inventory/physical-count.ts` | Physical count session and approval behavior. |
| `lib/domains/inventory/opening-stock.ts` | Opening stock view and replacement behavior for the active session. |
| `lib/domains/inventory/types.ts` | Inventory domain type exports. |
| `lib/domains/indents/ksbcl-parser.ts` | KSBCL file parsing behavior. |
| `lib/domains/indents/ksbcl-match.ts` | KSBCL item matching behavior. |
| `lib/domains/indents/receipts.ts` | Supplier receipt posting behavior. |
| `lib/domains/indents/types.ts` | Indent domain type exports. |
| `lib/domains/catalog/product-import.ts` | Product workbook import behavior. |
| `lib/domains/catalog/infer-category.ts` | Product category inference helper. |
| `lib/domains/catalog/types.ts` | Catalog domain type exports. |
| `lib/domains/catalog/misc-items.ts` | Misc item CRUD and misc sales metrics behavior. |
| `lib/domains/cash/types.ts` | Cash and ledger domain type exports. |
| `lib/domains/attendance/types.ts` | Attendance domain type exports. |
| `lib/domains/staff/metrics.ts` | Staff performance and attendance metrics. |
| `lib/domains/staff/payroll.ts` | Staff payroll reporting behavior. |
| `lib/platform/index.ts` | Shared platform barrel for dates, Prisma, types, and validation exports. |
| `lib/platform/dates.ts` | Date parsing and business date helpers. |
| `lib/platform/prisma.ts` | Shared Prisma client. |
| `lib/platform/types.ts` | Shared branded and domain types. |
| `lib/platform/zod-schemas.ts` | Shared Zod validation helpers and API error helper. |
| `lib/*.ts` | Root compatibility facades that re-export canonical domain/platform modules. |

## Tests

| File | Purpose |
| --- | --- |
| `lib/api/routes.test.ts` | Ensures every API route file and HTTP method is registered. |
| `lib/api/handler.test.ts` | Unit coverage for shared API handler helpers. |
| `lib/domain-modules.test.ts` | Ensures every production `lib` module has one domain owner. |
| `lib/domains/billing/bill.test.ts` | Unit coverage for billing behavior. |
| `lib/domains/billing/bill.e2e.test.ts` | End-to-end style billing behavior coverage with mocked persistence. |
| `lib/domains/billing/bill.db.integration.test.ts` | Database-oriented billing integration coverage. |
| `lib/domains/billing/compute.test.ts` | Unit coverage for cart pricing computation. |
| `lib/domains/billing/preconditions.test.ts` | Unit coverage for billing precondition checks. |
| `lib/domains/billing/third-party-ledger.test.ts` | Unit coverage for third-party payout aggregation. |
| `lib/domains/catalog/misc-items.test.ts` | Unit coverage for misc item CRUD and sales metrics. |
| `lib/domains/inventory/opening-stock.test.ts` | Unit coverage for opening stock snapshot and replacement behavior. |
| `lib/domains/inventory/stock.test.ts` | Stock behavior coverage. |
| `lib/domains/staff/metrics.test.ts` | Unit coverage for staff metrics aggregation. |

## Prisma And Scripts

| File | Purpose |
| --- | --- |
| `prisma/schema.prisma` | Database schema and Prisma model definitions. |
| `prisma/seed.ts` | Seed users and optional product workbook import. |
| `prisma/migrations/20260501000000_init/migration.sql` | Initial database migration. |
| `scripts/migrate-deploy-with-retry.sh` | Render migration retry helper. |
| `scripts/setup-face-models.ts` | Face model setup helper. |
| `scripts/collab-check.ts` | Guardrail script that fails risky cross-domain or facade edits in a single change. |

## Docs

| File | Purpose |
| --- | --- |
| `docs/development-architecture.md` | Development architecture, dependency direction, and behavior ownership rules. |
| `docs/development-playbook.md` | Step-by-step recipes for adding routes, domain behavior, pages, Prisma changes, and high-risk changes. |
| `docs/collaboration-protocol.md` | Team workflow for branch scope, task claims, write boundaries, and merge gates. |
| `docs/api-routes.md` | Human-readable API route map. |
| `docs/architecture-checkpoint.md` | Foundation refactor rationale and baseline contract. |
| `docs/file-index.md` | This file index. |
| `docs/requirements-verification.md` | Business requirement verification and known product gaps. |
