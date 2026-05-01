# Liquor Management (Web-Only)

Production-oriented rewrite for a single-outlet liquor operations system.

## Business Verification

The current repo has been verified against the bar's all-in-one operating model:

- liquor inventory and reconciliation
- cashier-owned misc goods
- combined billing with split owner vs cashier tallies
- cashier reimbursement controls
- POS barcode workflow
- facial attendance
- accounting and audit requirements

Read the full verification here:

- `docs/requirements-verification.md`
- `docs/api-routes.md`
- `docs/development-architecture.md`
- `docs/file-index.md`
- `docs/architecture-checkpoint.md`

Current status:

- foundation and schema: strong
- live POS for mixed billing: not complete
- cashier reimbursement engine: not complete
- attendance recognition flow: not complete
- production readiness for the exact business rules: not yet ready

## Stack

- Next.js 14 (App Router)
- TypeScript strict mode
- PostgreSQL (Neon) + Prisma
- NextAuth PIN login
- Tailwind + Radix UI
- Zod validation

## Local Setup

1. Copy env template:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Generate Prisma client and migrate:

```bash
npm run prisma:generate
npm run prisma:push
```

4. Seed baseline users and optionally import workbook products:

```bash
npm run seed
```

If you want to force a specific workbook path:

```bash
npm run seed -- --excel "../MV PHYSICAL STOCK SHEET-29-03-2026 To 06-03-2026.xlsx"
```

5. Start app:

```bash
npm run dev
```

## Excel Product Import

- API route: POST /api/admin/products/import (multipart form with field name file)
- UI page: /products import action
- Supports:
  - Structured workbook columns: itemCode, name, category, sizeMl, bottlesPerCase, mrp, sellingPrice, barcode
  - Current stock sheet format (uses SALES & RATE tab)
- If item code is missing, importer generates placeholder values like KSBCL-PENDING-0001.
- You can edit these later to real KSBCL item codes.

## Render Deployment (Minimal Effort)

This repo includes render.yaml and scripts/migrate-deploy-with-retry.sh.

1. Push this repository.
2. In Render, create Web Service from repo.
3. Render auto-detects render.yaml.
4. Set env vars from .env.example.
5. Deploy.

Build flow on Render:

- npm ci
- prisma migrate deploy (with retry)
- prisma generate
- next build
- next start

## CI and Scheduled Rollover

- CI workflow: .github/workflows/ci-and-deploy.yml
- Daily rollover trigger workflow: .github/workflows/rollover-schedule.yml

For rollover workflow, set repository secrets:

- ROLLOVER_URL (example: https://your-app.onrender.com/api/cron/rollover)
- CRON_SECRET

## Current Scope in This Commit

- Full Prisma schema and enums
- Core libraries for dates, auth, stock, reconciliation, rollover
- NextAuth credentials PIN login and login page
- Product CRUD API foundation
- Excel import pipeline with placeholder KSBCL item codes
- Protected app layout and all page route scaffolding
- Build/lint verified clean
