# Mandatory Agent Rules

This file is the first-stop operating manual for every agent working in this repository. Read it before editing code.

## Required Reading

Before changing files, read these documents:

- `AGENTS.md`
- `docs/development-architecture.md`
- `docs/api-routes.md`
- `docs/file-index.md`
- `docs/requirements-verification.md` when touching business behavior

## Core Rule

Reliability is more important than speed. This is a complex, agent-built operational system for stock, billing, cash, attendance, and audit workflows. Make small, traceable changes that preserve domain boundaries.

## Architecture Rules

- Keep API route handlers thin. They may authenticate, parse input, call one domain function, and format the response.
- Put business behavior in `lib/domains/*` or `lib/platform/*`, not in pages, components, route handlers, or root `lib/*.ts` facade files.
- Do not duplicate money, stock, bill, attendance, or date logic in UI files.
- Update `lib/api/routes.ts` whenever an API route path, method, auth policy, data impact, or purpose changes.
- Update `lib/domain-modules.ts` whenever a behavior module or legacy facade is added, deleted, renamed, or changes domain ownership.
- Update `docs/file-index.md` whenever files are added, deleted, renamed, or materially repurposed.
- Prefer adding focused domain functions over expanding large UI files.
- Avoid broad refactors that mix behavior changes, styling changes, and file movement in one patch.

## Safety Rules

- Treat billing, stock, galla, reconciliation, attendance, biometric descriptors, and cron jobs as high-risk areas.
- Do not change database writes without checking the related Prisma model and existing tests.
- Do not introduce hidden side effects in helper functions.
- Do not use mock, sample, or fallback production behavior unless the file clearly marks it as test-only.
- Keep validation explicit with Zod or existing typed helpers.
- If a route writes money or stock data, prefer a transaction and add or update a focused test.

## Development Rules

- Before adding a new pattern, search for the existing local pattern first.
- Keep imports directional: UI calls routes/actions; routes/actions call domain modules; domain modules own behavior and data operations.
- Root `lib/*.ts` files are compatibility facades only. Do not add behavior there.
- Keep files named after their domain responsibility.
- Keep comments short and useful; document decisions in docs rather than narrating obvious code.
- Run the narrowest useful validation first, then broader checks when the repo baseline allows it.

## Required Checks For Reliability Files

Run these after changing API, domain ownership, or documentation indexes:

- `npm test -- lib/api/routes.test.ts lib/domain-modules.test.ts`
- `npx eslint lib/api/routes.ts lib/api/routes.test.ts lib/domain-modules.ts lib/domain-modules.test.ts`
