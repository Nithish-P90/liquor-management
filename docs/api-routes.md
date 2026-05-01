# API Route Registry

This project uses [lib/api/routes.ts](/Users/nithishp/Mahavishnu%20liquor%20manager/liquor-management/lib/api/routes.ts) as the single source of truth for API ownership, risk, auth, and data impact.

When adding or changing an API route:

1. Update the route handler in `app/api/**/route.ts`.
2. Use `lib/api/handler.ts` helpers for auth, query/body parsing, and error boundaries when practical.
3. Update the matching entry in `lib/api/routes.ts`.
4. Run `npm test -- lib/api/routes.test.ts`.

The registry test fails when a route file, path, or HTTP method drifts from the documented contract.

## Route Map

| Route | Methods | Auth | Domain | Risk | Purpose |
| --- | --- | --- | --- | --- | --- |
| `/api/auth/[...nextauth]` | `GET`, `POST` | `public-nextauth` | `auth` | high | NextAuth credentials endpoint for PIN login session creation and callback handling. |
| `/api/products` | `GET`, `POST` | `session` | `catalog` | high | Lists products with sizes, or creates a product with one or more sellable sizes. |
| `/api/products/[id]` | `PATCH`, `DELETE` | `admin` | `catalog` | high | Updates product metadata and sizes, or deletes an unused product. |
| `/api/products/[id]/barcode` | `PATCH` | `admin` | `catalog` | medium | Assigns or updates the barcode for a product size. |
| `/api/admin/products/import` | `POST` | `admin` | `catalog` | high | Imports products and sizes from an uploaded workbook. |
| `/api/expense-categories` | `GET`, `POST` | `session` | `accounting` | medium | Lists expense categories or creates a new active category. |
| `/api/expenses` | `GET`, `POST` | `session` | `accounting` | high | Lists expenses for a date range or records a new expenditure. |
| `/api/ledger` | `GET` | `session` | `accounting` | medium | Returns owner and cashier ledger rows for reporting. |
| `/api/galla` | `GET` | `session` | `cash` | medium | Returns the galla day, cash events, and computed balance for a business date. |
| `/api/galla/close` | `POST` | `session` | `cash` | high | Closes a galla day with counted cash and records the variance. |
| `/api/pos/items` | `GET` | `session` | `pos` | medium | Returns all sellable liquor sizes and active misc items for the POS picker. |
| `/api/pos/search` | `GET` | `session` | `pos` | medium | Searches liquor and misc items by name, item code, or barcode. |
| `/api/pos/barcode/[code]` | `GET` | `session` | `pos` | high | Resolves a scanned barcode to either a liquor product size or misc item. |
| `/api/pos/map-barcode` | `POST` | `session` | `pos` | high | Maps an unknown barcode to an existing liquor size or misc item. |
| `/api/pos/open-tabs` | `GET` | `session` | `pos` | medium | Lists pending open customer tabs that can be resumed or settled. |
| `/api/pos/recent-bills` | `GET` | `session` | `pos` | medium | Lists recent bills for reprint, review, or void workflows. |
| `/api/settings` | `GET`, `POST` | `session` | `pos` | medium | Returns or updates global system settings and operational thresholds. |
| `/api/indents` | `GET` | `admin` | `indents` | medium | Lists recent supplier indents with items and receipt references. |
| `/api/indents/[id]` | `GET` | `admin` | `indents` | medium | Returns one indent with parsed items, mappings, and receipt details. |
| `/api/indents/parse` | `POST` | `admin` | `indents` | high | Parses an uploaded KSBCL indent file into an indent and line items. |
| `/api/indents/[id]/confirm` | `POST` | `admin` | `indents` | high | Confirms arrival for an indent and posts receipt stock movements. |
| `/api/indents/[id]/map-item` | `POST` | `admin` | `indents` | medium | Maps a parsed KSBCL indent item to a known product size. |
| `/api/clearance` | `GET`, `POST` | `session` | `inventory` | high | Lists clearance batches or creates a discounted clearance batch. |
| `/api/clearance/[id]/cancel` | `POST` | `session` | `inventory` | high | Cancels a clearance batch and stops discounted sale availability. |
| `/api/physical-count` | `GET`, `POST` | `admin` | `inventory` | high | Lists physical count sessions or creates a new count session with counted lines. |
| `/api/physical-count/[id]/approve` | `POST` | `admin` | `inventory` | high | Approves a physical count session and posts adjustment movements. |
| `/api/reconciliation` | `GET`, `PATCH` | `admin` | `inventory` | high | Lists reconciliation rows and lets admins approve or note variance decisions. |
| `/api/attendance` | `GET` | `session` | `attendance` | medium | Returns attendance logs for a selected business date. |
| `/api/attendance/punch` | `POST` | `session` | `attendance` | high | Records staff check-in or check-out events from manual or face-matched flows. |
| `/api/face/enroll` | `POST` | `admin` | `attendance` | high | Stores face descriptor samples for a staff member. |
| `/api/face/profiles` | `GET` | `session` | `attendance` | high | Returns enrolled face descriptors for local browser-side matching. |
| `/api/staff` | `GET`, `POST` | `session` | `staff` | medium | Lists active staff with role and face enrollment status, or creates a new staff member. |
| `/api/clerks` | `GET`, `POST` | `session` | `staff` | medium | Lists active clerks or creates a new clerk for POS attribution. |
| `/api/notifications` | `GET` | `session` | `notifications` | medium | Lists active user-visible notifications and operational alerts. |
| `/api/notifications/[id]/dismiss` | `POST` | `session` | `notifications` | low | Dismisses a notification for the current workflow. |
| `/api/cron/rollover` | `POST` | `cron-secret` | `cron` | high | Runs the daily rollover job guarded by CRON_SECRET. |
| `/api/cron/eod` | `POST` | `cron-secret` | `cron` | high | Runs end-of-day processing for the previous business date. |

## Reliability Rules

- High-risk routes touch money, stock, authentication, biometric data, or day-close state. Add or update focused tests before changing them.
- Keep route handlers thin. Validation can live in the route, but business behavior should live in `lib/domains/*` modules.
- Every API response shape used by UI pages should be represented by a named type near the consuming module or in a shared domain file.
- Any new route must have an owner, risk level, auth policy, reads list, writes list, and summary in the registry.
