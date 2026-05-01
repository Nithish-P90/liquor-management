# Mandatory Agent Rules

This file is the first-stop operating manual for every agent working in this repository. Read it before editing code.

## File Name Compatibility

Some agent runtimes look for different casing or singular/plural names.
This repository keeps synchronized aliases:

- `AGENTS.md` (canonical)
- `AGENT.md` (alias)
- `agent.md` (alias)

If you edit one, update all three in the same change.

## Required Reading

Before changing files, read these documents:

- `AGENTS.md`
- `AGENT.md`
- `agent.md`
- `docs/development-architecture.md`
- `docs/development-playbook.md`
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

## Anti-Spaghetti Rules

- Do not add new behavior to files that are already overloaded if a split is practical.
- Do not create circular dependencies between `lib/domains/*` modules.
- Do not mix unrelated concerns in a single function.
- Do not let UI state, network fetches, and payment/stock business rules accumulate in one component.
- Do not use anonymous untyped objects for shared response shapes.
- Do not hide control flow in side effects that are hard to trace.

## Modularity Requirements

- New business behavior must be exposed from a domain module with named input and output types.
- New route logic must call domain functions rather than implement business rules inline.
- Shared API validation/auth/error boilerplate should use `lib/api/handler.ts` helpers where practical.
- If a page grows beyond practical readability, split it into local feature components and hooks.
- Keep feature modules discoverable with predictable names:
  - `actions.ts` for page-specific server actions
  - `types.ts` for shared domain/page shapes
  - `constants.ts` for static feature constants
  - `use*.ts` hooks for reusable client behavior

## Size And Complexity Budgets

These are guardrails, not absolute laws. If you exceed them, add a short note in the handoff and split soon.

- Target route files: under 220 lines.
- Target page/component files: under 350 lines.
- Target domain files: under 450 lines.
- Target function length: under 80 lines.
- Prefer max nesting depth of 3 levels per function.

When you cross these limits, schedule decomposition in the same change when feasible.

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

## Required Structure For New Features

For each new feature, include:

1. Domain behavior in `lib/domains/<domain>/...`.
2. Named types in domain `types.ts` when the shape is consumed elsewhere.
3. Route registration updates in `lib/api/routes.ts` when routes are touched.
4. Ownership updates in `lib/domain-modules.ts` when modules are added/moved.
5. File index updates in `docs/file-index.md`.
6. Focused tests for business-critical behavior.

## Required Checks For Reliability Files

Run these after changing API, domain ownership, or documentation indexes:

- `npm test -- lib/api/routes.test.ts lib/domain-modules.test.ts`
- `npx eslint lib/api/handler.ts lib/api/handler.test.ts lib/api/routes.ts lib/api/routes.test.ts lib/domain-modules.ts lib/domain-modules.test.ts`

## Pre-Commit Checklist

Before committing code changes:

1. Run `npm run check`.
2. Confirm no local data artifacts are staged unless explicitly requested:
   - `cost sheet.csv`
   - raw uploaded workbooks
3. Confirm route and domain indexes match file changes.
4. Confirm new behavior has at least one focused test or an explicit rationale why not.
